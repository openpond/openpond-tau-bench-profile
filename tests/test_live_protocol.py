"""Exercise native Gym/orchestrator without sending any provider requests."""
import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).parents[1] / 'python/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
from tau2.user.user_simulator import UserSimulator
from tau2.data_model.message import UserMessage

class ScriptedCustomer(UserSimulator):
    def __init__(self):
        super().__init__(llm='controlled-fixture')
        self.turns = 0
    def generate_next_message(self, message, state):
        self.turns += 1
        return UserMessage(role='user', content='Please help with my order.' if self.turns == 1 else '###STOP###'), state

class ProtocolTest(unittest.TestCase):
    def test_tool_ids_and_native_collection(self):
        with patch.dict(os.environ, {'OPENPOND_OPCHAT_BASE_URL':'https://staging-api.openpond.ai/opchat/v1','OPENPOND_API_KEY':'controlled-test-no-network'}), patch.object(bridge.AgentGymEnv, '_get_user', lambda _: ScriptedCustomer()):
            started = bridge.handle({'op':'live_start','taskId':'33','maxTurns':30})
            self.assertIn('Please help',started['userPrompt'])
            for i, action in enumerate(bridge.tasks['33'].evaluation_criteria.actions):
                import json
                result=bridge.handle({'op':'live_step','content':None,'toolCalls':[{'id':f'test-{i}','name':action.name,'arguments':json.dumps(action.arguments)}]})
                self.assertEqual(result['toolResults'][0]['id'], f'test-{i}')
                self.assertEqual(result['toolResults'][0]['name'], action.name)
            result=bridge.handle({'op':'live_step','content':'Your address has been updated.','toolCalls':[]})
            self.assertTrue(result['terminal'])
            self.assertEqual(result['grading']['reward'], 1.0)

if __name__ == '__main__':
    unittest.main()
