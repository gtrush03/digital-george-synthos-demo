import { buildQuestions, interpret, object, QUESTION_VERSION, validateRequest } from './contracts.ts';
import type { AttemptReceipt, DecisionPolicy, DecisionReceipt, DecisionRequest, EvaluateOptions, Provider, Questions, ValidatedResult } from './types.ts';
export const PROVIDERS = {
  openrouter: { endpoint:'https://openrouter.ai/api/alpha/decisions', model:'typesafe/jev-1.13', approved:['typesafe/jev-1.13-20260917'] },
  typesafe: { endpoint:'https://api.typesafe.ai/v1/systemone', model:'jev-1.13.0', approved:['jev-1.13.0'] },
} as const;
export function defaultPolicy(provider:Provider):DecisionPolicy {
  return { requestedModel:PROVIDERS[provider].model, approvedReturnedModels:PROVIDERS[provider].approved, maxAttempts:1,totalTimeoutMs:12000,maxContextBytes:16000,maxResponseBytes:64000,minConfidence:0.8,minWinningProbability:0.85,inputUsdPerMillion:0.042,maxConcurrent:4 };
}
export function canonical(value:unknown):string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
export async function hashValue(value:unknown):Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function number(value:unknown, min=0,max=Number.MAX_SAFE_INTEGER): asserts value is number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('Invalid response number');
}
export function validateResult(raw:unknown, questions:Questions):ValidatedResult {
  const r=object(raw); if(typeof r.model!=='string')throw new Error('Missing model');
  const answers=object(r.answers);
  if(Object.keys(answers).length!==Object.keys(questions).length)throw new Error('Unexpected answer keys');
  for(const [id,q] of Object.entries(questions)) {
    const a=object(answers[id]); if(a.type!==q.type)throw new Error('Wrong answer type');
    if(q.type==='noul'){number(a.noul,0,1);continue;}
    number(a.confidence,0,1); const p=object(a.probabilities);const keys=Object.keys(q.criteria);
    if(Object.keys(p).length!==keys.length||Object.keys(p).some(k=>!keys.includes(k)))throw new Error('Unknown options');
    for(const key of keys)number(p[key],0,1);
    const values=Object.values(p) as number[];
    if(Math.abs(values.reduce((x,y)=>x+y,0)-1)>Math.max(0.011,keys.length*0.0051))throw new Error('Invalid distribution');
    if(typeof a.choice!=='string'||!keys.includes(a.choice)||(p[a.choice] as number)+0.011<Math.max(...values))throw new Error('Invalid winning choice');
  }
  const usage=object(r.usage);number(usage.input_tokens);number(usage.output_tokens);
  if(!Number.isInteger(usage.input_tokens)||!Number.isInteger(usage.output_tokens))throw new Error('Invalid token count');
  if(usage.cost!==undefined)number(usage.cost,0,Number.MAX_VALUE);
  return {model:r.model,answers:Object.fromEntries(Object.entries(questions).map(([id,q])=>{const a=answers[id] as Record<string,unknown>;return[id,q.type==='noul'?{type:'noul',noul:a.noul}:{type:'choice',choice:a.choice,confidence:a.confidence,probabilities:a.probabilities}];})) as ValidatedResult['answers'],usage:{input_tokens:usage.input_tokens,output_tokens:usage.output_tokens,...(usage.cost!==undefined?{cost:usage.cost}:{})},...(typeof r.id==='string'?{id:r.id}:{})};
}
function account(raw:unknown, attempt:AttemptReceipt, policy:DecisionPolicy) {
  if(!raw||typeof raw!=='object')return;
  const r=raw as Record<string,unknown>;if(typeof r.model==='string')attempt.returnedModel=r.model.slice(0,200);
  if(!r.usage||typeof r.usage!=='object')return;
  const u=r.usage as Record<string,unknown>;
  if(typeof u.input_tokens==='number'&&Number.isSafeInteger(u.input_tokens)&&u.input_tokens>=0)attempt.inputTokens=u.input_tokens;
  if(typeof u.output_tokens==='number'&&Number.isSafeInteger(u.output_tokens)&&u.output_tokens>=0)attempt.outputTokens=u.output_tokens;
  if(typeof u.cost==='number'&&Number.isFinite(u.cost)&&u.cost>=0){attempt.billing='reported';attempt.costUsd=u.cost;}
  else if(attempt.inputTokens!==undefined){attempt.billing='estimated';attempt.costUsd=attempt.inputTokens*policy.inputUsdPerMillion/1e6;}
}
async function boundedJson(response:Response, max:number):Promise<unknown> {
  if(!response.body)throw new Error('Missing response body');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
  try { while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>max){await reader.cancel();throw new Error('Response too large');}chunks.push(next.value);} }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted)return Promise.reject(new Error('Aborted'));
  return new Promise((resolve,reject)=>{const abort=()=>reject(new Error('Aborted'));signal.addEventListener('abort',abort,{once:true});work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
let inflight=0;
export async function evaluateDecision(input:DecisionRequest,options:EvaluateOptions):Promise<DecisionReceipt>{
  const request=validateRequest(input);const questions=buildQuestions(request);const policy={...defaultPolicy(options.provider),...options.policy};
  if(!Number.isInteger(policy.maxAttempts)||policy.maxAttempts<1||policy.maxAttempts>3||!Number.isInteger(policy.maxConcurrent)||policy.maxConcurrent<1||policy.maxConcurrent>16||policy.totalTimeoutMs<1||policy.totalTimeoutMs>60000||!Number.isFinite(policy.totalTimeoutMs))throw new Error('Invalid bounded policy');
  if(policy.requestedModel!==PROVIDERS[options.provider].model||!policy.approvedReturnedModels.length||policy.approvedReturnedModels.some(x=>!/jev-\d/.test(x)||/latest|preview/.test(x)))throw new Error('Explicit approved model pin required');
  for(const v of [policy.maxContextBytes,policy.maxResponseBytes])if(!Number.isInteger(v)||v<100||v>128000)throw new Error('Invalid size bound');
  for(const v of [policy.minConfidence,policy.minWinningProbability])number(v,0,1);
  number(policy.inputUsdPerMillion,0,1);
  const start=Date.now();const snapshot=await hashValue(request.state);const hashes={snapshot,questions:await hashValue(questions),choices:await hashValue(Object.fromEntries(Object.entries(questions).filter(([,q])=>q.type==='choice').map(([k,q])=>[k,q.type==='choice'?q.criteria:{}])))};
  const receipt:DecisionReceipt={schemaVersion:'jev.receipt.v1',id:await hashValue({context:request.context,contractId:request.contractId,hashes,model:policy.requestedModel,approved:policy.approvedReturnedModels,questionVersion:QUESTION_VERSION}),contractId:request.contractId,context:request.context,questionVersion:QUESTION_VERSION,disposition:'abstained',reason:'unknown',model:{provider:options.provider,requested:policy.requestedModel},attempts:[],hashes,cost:{knownUsd:0,estimatedUsd:0,unknownAttempts:0},observedAt:request.context.observedAt,completedAt:'',latencyMs:0,appliedAction:null};
  const finish=(disposition:DecisionReceipt['disposition'],reason:string)=>{receipt.disposition=disposition;receipt.reason=reason;receipt.completedAt=new Date().toISOString();receipt.latencyMs=Date.now()-start;receipt.cost={knownUsd:receipt.attempts.filter(a=>a.billing==='reported').reduce((n,a)=>n+(a.costUsd??0),0),estimatedUsd:receipt.attempts.filter(a=>a.billing==='estimated').reduce((n,a)=>n+(a.costUsd??0),0),unknownAttempts:receipt.attempts.filter(a=>a.billing==='unknown').length};return receipt;};
  if(options.signal?.aborted)return finish('cancelled','host_cancelled');
  if(request.context.snapshotHash&&request.context.snapshotHash!==snapshot)return finish('stale','snapshot_mismatch');
  if(new TextEncoder().encode(JSON.stringify({state:request.state,questions})).length>policy.maxContextBytes)return finish('abstained','context_limit');
  if(request.contractId==='attention.v1'&&!request.state.changed&&!request.state.due)return finish('skipped','unchanged_observation');
  const deadline=Math.min(Date.parse(request.context.deadlineAt),start+policy.totalTimeoutMs);
  if(deadline<=Date.now())return finish('abstained','deadline');
  if(inflight>=policy.maxConcurrent)return finish('abstained','concurrency_limit');
  if(!options.credential.trim())return finish('provider_error','missing_credential');
  inflight++;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.max(1,deadline-Date.now()));const onAbort=()=>controller.abort();options.signal?.addEventListener('abort',onAbort,{once:true});
  try {
    for(let index=1;index<=policy.maxAttempts;index++){
      if(controller.signal.aborted)return finish(options.signal?.aborted?'cancelled':'abstained',options.signal?.aborted?'host_cancelled':'deadline');
      const began=Date.now();const attempt:AttemptReceipt={index,status:'network_error',latencyMs:0,billing:'unknown'};receipt.attempts.push(attempt);
      try {
        const response=await abortable((options.fetch??fetch)(PROVIDERS[options.provider].endpoint,{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${options.credential}`,'Content-Type':'application/json'},body:JSON.stringify({model:policy.requestedModel,state:request.state,questions}),signal:controller.signal}),controller.signal);
        if(!response.ok){
          attempt.status='http_error';attempt.httpStatus=response.status;attempt.latencyMs=Date.now()-began;await abortable(response.body?.cancel()??Promise.resolve(),controller.signal);
          const retry=[408,429,500,502,503,504,529].includes(response.status)&&index<policy.maxAttempts;
          const header=response.headers.get('retry-after');const parsed=header?Number(header):NaN;const delay=header?(Number.isFinite(parsed)?parsed*1000:Date.parse(header)-Date.now()):100*index;
          if(retry&&Number.isFinite(delay)&&delay>=0&&Date.now()+delay+100<deadline){await abortable(new Promise(resolve=>setTimeout(resolve,delay)),controller.signal);continue;}
          return finish('provider_error',response.status===429?'rate_limited':response.status===401||response.status===403?'authentication':'provider_http');
        }
        let raw:unknown;
        try {raw=await abortable(boundedJson(response,policy.maxResponseBytes),controller.signal);}catch(error){if(controller.signal.aborted)throw error;attempt.status='invalid_answer';attempt.latencyMs=Date.now()-began;return finish('abstained','invalid_answer');}
        account(raw,attempt,policy);attempt.latencyMs=Date.now()-began;
        if(attempt.returnedModel)receipt.model.returned=attempt.returnedModel;
        if(!attempt.returnedModel||!policy.approvedReturnedModels.includes(attempt.returnedModel)){attempt.status='model_changed';return finish('abstained','model_changed');}
        let result:ValidatedResult;try{result=validateResult(raw,questions);}catch{attempt.status='invalid_answer';return finish('abstained','invalid_answer');}
        receipt.answers=result.answers;attempt.status='success';const interpreted=interpret(request,result.answers,policy.minConfidence,policy.minWinningProbability);
        receipt.recommendation=interpreted.recommendation;
        return finish(interpreted.recommendation?'accepted':'abstained',interpreted.reason);
      }catch{
        attempt.latencyMs=Date.now()-began;
        if(controller.signal.aborted){attempt.status=options.signal?.aborted?'cancelled':'timeout';return finish(options.signal?.aborted?'cancelled':'abstained',options.signal?.aborted?'host_cancelled':'deadline');}
        attempt.status='network_error';if(index===policy.maxAttempts)return finish('provider_error','provider_unavailable');
      }
    }
    return finish('provider_error','attempts_exhausted');
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);inflight--;}
}
/** Offline, immutable historical inspection. No model, reservation, task mutation or effect. */
export function replayReceipt(receipt:DecisionReceipt):DecisionReceipt {
  if(receipt.schemaVersion!=='jev.receipt.v1'||receipt.appliedAction!==null)throw new Error('Invalid advisory receipt');
  return {...structuredClone(receipt),replayed:true,originalReceiptId:receipt.id,reason:`offline_replay:${receipt.reason}`};
}
