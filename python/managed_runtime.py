"""Implements OpenPond's existing managedRlJsonlRuntime.v1 protocol.

The trainable policy is owned by OpenPond. This process only executes the task,
advances the Fireworks customer and returns the native evaluator result.
"""
import json
import sys

# Kept together with bridge.py when materialized into a Taskset runtime.
import bridge

task_id = sys.argv[1]
grader_id = sys.argv[2]
if grader_id != 'tau-retail-native-db':
    raise ValueError('Unknown native grader')


def execute(request):
    operation = request['operation']
    if operation == 'init':
        result = bridge.handle({'op':'live_start','taskId':task_id,'maxTurns':50})
        return {'environmentVersion':bridge.REVISION, **result}
    if operation == 'step':
        result = bridge.handle({'op':'live_step','content':request.get('content'),'toolCalls':request.get('toolCalls',[])})
        grading = result.get('grading')
        return {**result, 'reward': grading['reward'] if grading else 0, 'components': {'native':grading['reward']} if grading else {}, 'stateHashes':{'store': bridge.gym._orchestrator.environment.get_db_hash()}, 'terminationReason': result.get('simulation',{}).get('termination_reason')}
    if operation == 'terminate':
        return {'toolResults':[],'userMessage':None,'terminal':True,'reward':0,'components':{},'stateHashes':{},'terminationReason':request['reason']}
    raise ValueError('Unknown managed runtime operation')

if __name__ == '__main__':
    for line in sys.stdin:
        try:
            print(json.dumps(execute(json.loads(line))),flush=True)
        except Exception as error:
            print(json.dumps({'fatal':type(error).__name__,'message':'τ managed runtime failed; no native success receipt.'}),flush=True)
            break
