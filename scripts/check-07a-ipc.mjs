// Additional native lifecycle checks through the app's ordinary isolated IPC.
// Never calls test-only commands, changes user settings, or touches source files.
export async function runNativeChecks(page, demo) {
  return page(`(async()=>{
    if(typeof window.__TAURI_INTERNALS__?.invoke!=='function')throw new Error('Ordinary Tauri IPC unavailable');
    const invoke=(command,args={})=>window.__TAURI_INTERNALS__.invoke(command,args);
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const checks=[], consumers=[], jobs=[], leases=[], observations={};
    const assert=(condition,name)=>{if(!condition)throw new Error(name);checks.push(name);};
    const id=()=>crypto.randomUUID();
    const requestId=()=> 'verify-'+id();
    const request=(path,consumer_id,edge=128)=>({path,consumer_id,edge});
    const start=async request=>{const requestIdValue=requestId();jobs.push(requestIdValue);await invoke('thumbnail_request_start',{requestId:requestIdValue,request});return requestIdValue;};
    const release=consumerId=>invoke('thumbnail_release',{consumerId});
    const poll=async requestId=>{const deadline=performance.now()+10000;for(;;){const state=await invoke('job_poll',{requestId});if(state.error)throw new Error(state.error);if(state.done){if(state.result?.lease)leases.push(state.result.lease.lease_id);return state.result;}if(performance.now()>deadline)throw new Error('Native thumbnail job timed out');await delay(10);}};
    const expectError=async(work,code)=>{try{await work();return false;}catch(error){return String(error).includes(code);}};
    const fetchLease=async lease=>{const response=await fetch('http://adpfile.localhost/'+lease.token+'/'+encodeURIComponent(lease.name),{cache:'no-store'});if(!response.ok)throw new Error('Lease response '+response.status);return [...new Uint8Array(await response.arrayBuffer())];};
    const path=${JSON.stringify(joinWindows(demo, "landscape.png"))};
    try {
      const idleDeadline=performance.now()+5000;
      while(true){const state=await invoke('background_status');if(state.running===0&&state.queued===0)break;if(performance.now()>idleDeadline)throw new Error('UI thumbnail work did not drain');await delay(25);}
      await invoke('cache_clear',{kind:'thumbnail'});
      const first=id(),second=id();consumers.push(first,second);
      const before=await invoke('background_status');
      const work=await Promise.all([start(request(path,first)),start(request(path,second))]);
      observations.same_key={before,after_start:await invoke('background_status')};
      await release(first);
      const survivor=await poll(work[1]);
      assert(survivor.state==='ready'&&!!survivor.lease,'native same-key survivor is ready after first consumer release');
      // The leader's polled state is not evidence of helper coalescing. Only
      // survivor success is asserted; helper process count is not measured.
      const bytes=await fetchLease(survivor.lease);
      assert(bytes.length>8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value),'native thumbnail lease serves actual PNG bytes');
      const cleared=await invoke('cache_clear',{kind:'thumbnail'});
      const retained=await fetchLease(survivor.lease);
      assert(JSON.stringify(bytes)===JSON.stringify(retained),'cache clear preserves exact bytes of a live native lease');
      assert(cleared.pending_delete_bytes>=bytes.length&&cleared.leased_count>=1,'cache clear reports retained leased bytes');
      await release(second);
      await invoke('cache_release',{leaseId:survivor.lease.lease_id});
      await invoke('cache_release',{leaseId:survivor.lease.lease_id});
      // A final clear performs the scheduled owned cleanup and reports it.
      const released=await invoke('cache_clear',{kind:'thumbnail'});
      assert(released.pending_delete_bytes===0,'released native lease allows pending-delete cleanup');
      observations.lease_usage={cleared,released};
      const cancelled=id(), cancelledJob=requestId();consumers.push(cancelled);
      await release(cancelled);
      assert(await expectError(()=>invoke('thumbnail_request_start',{requestId:cancelledJob,request:request(path,cancelled)}),'background.cancelled'),'native release-before-start is acknowledged as cancelled');
      assert(await expectError(()=>invoke('job_poll',{requestId:cancelledJob}),'jobs.unknown'),'release-before-start never creates a pollable job');
      // Real WIC helpers may finish before all IPC requests reach admission.
      // Record the actual peak; never claim full saturation unless observed.
      const burst=Array.from({length:259},(_,index)=>({consumer:id(),path:${JSON.stringify(joinWindows(demo, "many"))}+'\\\\picture-'+String(index+1).padStart(4,'0')+'.png'}));
      consumers.push(...burst.map(item=>item.consumer));
      const settled=burst.map(item=>start(request(item.path,item.consumer,64)).then(job=>({job}),error=>({error:String(error)})));
      let peakRunning=0,peakQueued=0;const samples=[];const until=performance.now()+1500;
      do{const state=await invoke('background_status');peakRunning=Math.max(peakRunning,state.running);peakQueued=Math.max(peakQueued,state.queued);if(samples.length<100)samples.push(state);if(state.running>2||state.queued>256)throw new Error('Native background admission exceeded capacity');await delay(10);}while(performance.now()<until);
      assert(peakRunning<=2&&peakQueued<=256,'native observed background admission stays within 2 active / 256 waiting');
      await Promise.all(burst.map(item=>release(item.consumer)));
      const outcomes=await Promise.all(settled);
      const errors=outcomes.filter(item=>item.error).map(item=>item.error);
      const busy=errors.filter(error=>error.includes('background.busy')||error.includes('thumbnail.busy')).length;
      observations.admission={requests:259,peak_running:peakRunning,peak_queued:peakQueued,busy_replies:busy,full_saturation_exercised:peakRunning===2&&peakQueued===256&&busy>0,samples,errors};
      assert(!errors.some(error=>!['background.cancelled','background.busy','thumbnail.busy'].some(code=>error.includes(code))),'native admission burst has only expected busy/cancelled start errors');
      const drainedDeadline=performance.now()+5000;
      while(true){const state=await invoke('background_status');if(state.running===0&&state.queued===0)break;if(performance.now()>drainedDeadline)throw new Error('Native cancelled burst did not drain');await delay(10);}
      checks.push('native released admission burst drains active and queued work');
      return {passed:true,checks,observations,limitations:['Actual helper process count was not measured; same-key survivor success alone does not prove one helper.','Full queue rejection is exercised only when admission.full_saturation_exercised is true; fast real helpers may drain earlier.']};
    } catch(error) {
      return {passed:false,checks,observations,error:String(error.stack??error)};
    } finally {
      await Promise.allSettled(consumers.map(consumerId=>release(consumerId)));
      await Promise.allSettled(jobs.map(async requestId=>{await invoke('job_cancel',{requestId});try{const state=await invoke('job_poll',{requestId});if(state.result?.lease)await invoke('cache_release',{leaseId:state.result.lease.lease_id});}catch{}}));
      await Promise.allSettled(leases.map(leaseId=>invoke('cache_release',{leaseId})));
    }
  })()`);
}

function joinWindows(root, leaf) {
  return root.replace(/[\\/]$/, "") + "\\" + leaf;
}
