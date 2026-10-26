import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmail, mayAdvance } from '../apps/worker/src/google';
for(const [text,expected] of [['Thank you for applying','APPLICATION_CONFIRMED'],['Please complete this coding assessment','ONLINE_ASSESSMENT'],["We would like to schedule an interview",'INTERVIEW'],['We have decided to pursue other candidates','REJECTED'],['We are pleased to offer you the position','OFFER']] as const)test(text,()=>assert.equal(classifyEmail(text),expected));
test('confirmation cannot regress interview status',()=>assert.equal(mayAdvance('INTERVIEW','APPLICATION_CONFIRMED'),false));
test('terminal states require manual handling',()=>{assert.equal(mayAdvance('OFFER','REJECTED'),false);assert.equal(mayAdvance('REJECTED','INTERVIEW'),false);});
test('new interview can advance applied',()=>assert.equal(mayAdvance('APPLIED','INTERVIEW'),true));
