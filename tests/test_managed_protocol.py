"""The production JSONL wrapper speaks the existing RL protocol with native Gym.
The simulator alone is replaced to keep this contract test offline.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT=Path(__file__).parents[1]
class ManagedProtocolTest(unittest.TestCase):
    def test_managed_init_step_and_terminal_native_reward(self):
        bootstrap='''
import sys
sys.path.insert(0, 'python')
sys.argv=['managed_runtime.py','33','tau-retail-native-db']
import managed_runtime as runtime
from tau2.user.user_simulator import UserSimulator
from tau2.data_model.message import UserMessage
class Customer(UserSimulator):
    def __init__(self):
        super().__init__(llm='offline-test')
        self.calls=0
    def generate_next_message(self,message,state):
        self.calls+=1
        return UserMessage(role='user',content='Please help me.' if self.calls==1 else '###STOP###'),state
runtime.bridge.AgentGymEnv._get_user=lambda _:Customer()
for line in sys.stdin:
    print(__import__('json').dumps(runtime.execute(__import__('json').loads(line))),flush=True)
'''
        env={**os.environ,'OPENPOND_API_KEY':'offline-no-network','OPENPOND_OPCHAT_BASE_URL':'https://staging-api.openpond.ai/opchat/v1'}
        child=subprocess.Popen([sys.executable,'-c',bootstrap],cwd=ROOT,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
        def request(value):
            child.stdin.write(json.dumps(value)+'\n');child.stdin.flush()
            return json.loads(child.stdout.readline())
        try:
            initialized=request({'operation':'init'})
            self.assertIn('tools',initialized)
            tasks=json.loads((ROOT/'vendor/tau2-bench/data/tau2/domains/retail/tasks.json').read_text())
            for i,action in enumerate(next(t for t in tasks if t['id']=='33')['evaluation_criteria']['actions']):
                result=request({'operation':'step','toolCalls':[{'id':str(i),'name':action['name'],'arguments':json.dumps(action['arguments'])}],'content':None})
                self.assertFalse(result['terminal'])
            result=request({'operation':'step','toolCalls':[],'content':'Completed.'})
            self.assertTrue(result['terminal']);self.assertEqual(result['reward'],1)
            self.assertEqual(result['components'],{'native':1})
        finally:
            child.kill();child.wait(timeout=5)
            child.stdin.close();child.stdout.close()
