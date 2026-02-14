(function(){
  'use strict';
  const $ = (id)=>document.getElementById(id);

  $('loginBtn').addEventListener('click', async ()=>{
    $('msg').textContent='로그인 중...';
    $('msg').className='mt-2 text-xs text-zinc-400';
    try{
      const r = await fetch('/api/owner/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ username: $('username').value.trim(), password: $('password').value })
      });
      const j = await r.json();
      if(j.ok){
        $('msg').textContent='로그인 완료. /admin 으로 이동합니다.';
        $('msg').className='mt-2 text-xs text-emerald-300';
        setTimeout(()=>{ window.location.href='/admin'; }, 300);
      }else{
        $('msg').textContent='실패: ' + (j.error || r.status);
        $('msg').className='mt-2 text-xs text-red-300';
      }
    }catch(e){
      $('msg').textContent='에러: ' + String(e);
      $('msg').className='mt-2 text-xs text-red-300';
    }
  });
})();
