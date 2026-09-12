"""Recompute native grading from host-recorded simulation, never model scores."""
import json
import os
import sys
os.environ['PYTHON_DOTENV_DISABLED'] = '1'
from loguru import logger
logger.remove()
from tau2.data_model.tasks import Task
from tau2.data_model.simulation import SimulationRun
from tau2.evaluator.evaluator import evaluate_simulation, EvaluationType

value = json.load(sys.stdin)
task = Task.model_validate(value['expected']['task'])
simulation = SimulationRun.model_validate(value['evaluatorContext']['simulation'])
if simulation.task_id != task.id:
    raise ValueError('Simulation belongs to another task')
if [x.value for x in task.evaluation_criteria.reward_basis] != ['DB']:
    raise ValueError('Unsupported grading requirements')
result = evaluate_simulation(simulation, task, EvaluationType.ALL, False, 'retail')
print(json.dumps({'score': result.reward, 'passed': result.reward == 1, 'feedback': 'Native tau retail database evaluation.', 'evidenceRefs': []}))
