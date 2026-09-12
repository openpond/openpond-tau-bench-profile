"""Private, process-scoped τ runtime. Stdout is a request/response protocol."""
import contextlib
import json
import os
import sys
import uuid
from pathlib import Path

os.environ['PYTHON_DOTENV_DISABLED'] = '1'
os.environ['TAU2_DATA_DIR'] = str(Path(__file__).resolve().parents[1] / 'vendor/tau2-bench/data')
from loguru import logger
logger.remove()
with contextlib.redirect_stdout(sys.stderr):
    from tau2.domains.retail.environment import get_environment, get_tasks
    from tau2.data_model.message import AssistantMessage, ToolCall, UserMessage
    from tau2.data_model.simulation import SimulationRun, TerminationReason
    from tau2.evaluator.evaluator import evaluate_simulation, EvaluationType
    from tau2.gym.gym_agent import AgentGymEnv

REVISION = '672227c6b6676edc20d57ea53b7000262aae77b9'
tasks = {t.id: t for t in get_tasks(None)}
env = None
task = None
messages = []
gym = None
finished = False


def supported(t):
    return t.evaluation_criteria is not None and [str(x.value) for x in t.evaluation_criteria.reward_basis] == ['DB']


def snapshot():
    return {'tools': [t.openai_schema for t in env.get_tools()], 'policy': env.get_policy(), 'stateHash': env.get_db_hash()}


def handle(r):
    global env, task, messages, gym, finished
    op = r['op']
    if op == 'catalog':
        return {'revision': REVISION, 'tasks': [{'id': t.id, 'scenario': t.user_scenario.model_dump(mode='json'), 'rewardBasis': [x.value for x in t.evaluation_criteria.reward_basis], 'runnable': supported(t)} for t in tasks.values()]}
    if op == 'inspect':
        t = tasks[r['taskId']]
        return {'revision': REVISION, 'task': t.model_dump(mode='json'), 'runnable': supported(t), 'policy': get_environment().get_policy(), 'tools': [x.openai_schema for x in get_environment().get_tools()]}
    if op == 'start':
        if env is not None or gym is not None:
            raise ValueError('One attempt per process; create a fresh process to reset.')
        task = tasks[r['taskId']]
        if not supported(task):
            raise ValueError('This case requires grading capabilities not yet qualified by this profile.')
        env = get_environment()
        initial = task.initial_state
        messages = list(initial.message_history or []) if initial else []
        env.set_state(initial.initialization_data if initial else None, initial.initialization_actions if initial else None, messages)
        return snapshot()
    if op == 'step':
        if env is None or finished:
            raise ValueError('No active attempt')
        calls = [ToolCall(id=c['id'], name=c['name'], arguments=json.loads(c['arguments'])) for c in r.get('toolCalls', [])]
        messages.append(AssistantMessage(role='assistant', content=r.get('content'), tool_calls=calls or None))
        results = []
        for call in calls:
            response = env.get_response(call)
            messages.append(response)
            results.append({'id': call.id, 'name': call.name, 'output': response.content})
        return {'toolResults': results, 'userMessage': None, 'terminal': False}
    if op == 'finish':
        if env is None or finished:
            raise ValueError('No active attempt')
        finished = True
        simulation = SimulationRun(id=str(uuid.uuid4()), task_id=task.id, start_time='inspection', end_time='inspection', duration=0, termination_reason=TerminationReason.AGENT_STOP, messages=messages)
        score = evaluate_simulation(simulation, task, EvaluationType.ALL, False, 'retail')
        return {'toolResults': [], 'userMessage': None, 'terminal': True, 'grading': score.model_dump(mode='json'), 'stateHash': env.get_db_hash(), 'simulation': simulation.model_dump(mode='json')}
    if op == 'live_start':
        if env is not None or gym is not None:
            raise ValueError('One attempt per process')
        task = tasks[r['taskId']]
        if not supported(task):
            raise ValueError('Case grading is not qualified')
        # Credentials are inherited at execution only; never returned in evidence.
        base = os.environ['OPENPOND_OPCHAT_BASE_URL'].rstrip('/')
        if base not in ('https://staging-api.openpond.ai/opchat/v1', 'https://api.openpond.ai/opchat/v1'):
            raise ValueError('Use the current OpenPond OpChat endpoint')
        gym = AgentGymEnv(domain='retail', task_id=task.id, max_steps=r['maxTurns'], user_llm='openai/accounts/fireworks/models/deepseek-v4-flash', user_llm_args={'api_base': base, 'api_key': os.environ['OPENPOND_API_KEY'], 'temperature': 0, 'max_tokens': 2048, 'timeout': 60, 'num_retries': 0})
        gym.reset(seed=r.get('seed', 0))
        if gym._simulation_done.is_set():
            raise RuntimeError('Customer simulation failed to initialize')
        initial = [m.content for m in gym._agent.observation if isinstance(m, UserMessage) and m.content]
        return {'policy': gym._get_policy(), 'tools': [t.openai_schema for t in gym._get_tools()], 'userPrompt': '\n'.join(initial)}
    if op == 'live_step':
        if gym is None or finished:
            raise ValueError('No active live attempt')
        calls = [ToolCall(id=c['id'], name=c['name'], arguments=json.loads(c['arguments'])) for c in r.get('toolCalls', [])]
        action = AssistantMessage(role='assistant', content=r.get('content'), tool_calls=calls or None)
        # Preserve original tool-call IDs instead of reparsing Gym's text format.
        action = gym._agent._check_if_stop_toolcall(action)
        before = len(gym._agent.observation)
        gym._agent.set_action(action)
        while not gym._simulation_done.is_set() and not gym._agent.is_agent_turn:
            gym._simulation_done.wait(0.01)
        terminal = gym._simulation_done.is_set()
        if terminal and gym._simulation_run is None:
            raise RuntimeError('Customer/environment execution failed; no score available')
        observed = gym._agent.observation[before:]
        outputs = [{'id': m.id, 'name': next(c.name for c in calls if c.id == m.id), 'output': m.content} for m in observed if m.role == 'tool']
        users = [m.content for m in observed if m.role == 'user' and m.content]
        result = {'toolResults': outputs, 'userMessage': '\n'.join(users) or None, 'terminal': terminal}
        if terminal:
            finished = True
            reward, info = gym._get_reward()
            result['grading'] = json.loads(info)
            result['simulation'] = gym._simulation_run.model_dump(mode='json')
        return result
    raise ValueError('Unknown operation')

if __name__ == '__main__':
    for line in sys.stdin:
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                result = handle(request)
            print(json.dumps({'ok': True, 'result': result}), flush=True)
        except Exception as exc:
            # Provider exception text can contain request credentials; expose class only.
            print(json.dumps({'ok': False, 'error': type(exc).__name__}), flush=True)
