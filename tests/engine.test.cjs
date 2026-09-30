const {test}=require('node:test');
const assert=require('node:assert/strict');
const {appContext}=require('./helpers.cjs');

function setup(n=4){
  const app=appContext();
  app.run(`state=demoState();event().type='singles';event().format='knockout';event().entries=Array.from({length:${n}},(_,i)=>({id:'p_'+(i+1),name:'Player '+(i+1),p1:'Player '+(i+1),p2:'',seed:i+1}));generateDraw(event());`);
  return app;
}
test('first semifinal winner cannot become champion before the other semifinal',()=>{
  const a=setup();
  a.run(`forceWin(event().matches.find(m=>m.round==='Semi Final').id,'a')`);
  assert.equal(a.run(`event().matches.find(m=>m.round==='Final').status`),'pending');
  assert.equal(a.run(`findChampion(event())`),null);
});
test('knockouts from 2 to 33 entries require n-1 played matches and preserve every entrant',()=>{
  for(let n=2;n<=33;n++){
    const a=setup(n);
    const entrants=a.plain(`event().matches.filter(m=>m.roundIndex===0).flatMap(m=>[m.aId,m.bId]).filter(Boolean)`);
    assert.equal(new Set(entrants).size,n);
    assert.equal(a.run('findChampion(event())'),null);
    let played=0;
    while(!a.run('findChampion(event())')){
      assert.ok(played<n,`loop for ${n}`);
      a.run(`forceWin(event().matches.find(m=>m.status!=='completed'&&m.aId&&m.bId).id,'a')`);played++;
    }
    assert.equal(played,n-1,`matches for ${n}`);
  }
});
test('top seeds are in opposite halves; highest seeds receive byes',()=>{
  const a=setup(6),first=a.plain(`event().matches.filter(m=>m.roundIndex===0)`);
  assert.equal(first[0].aId,'p_1');assert.equal(first[2].aId,'p_2');
  assert.equal(first[0].bye,true);assert.equal(first[2].bye,true);
});
test('group qualifiers play the opposite group and correction removes unstarted knockout',()=>{
  const a=setup(4);
  a.run(`event().format='groups2';event().qualifiers=2;generateDraw(event());while(event().matches.some(m=>m.phase==='group'&&m.status!=='completed'))forceWin(event().matches.find(m=>m.phase==='group'&&m.status!=='completed').id,'a');`);
  assert.equal(a.run(`event().matches.filter(m=>m.round==='Semi Final').every(m=>event().entries.find(x=>x.id===m.aId).group!==event().entries.find(x=>x.id===m.bId).group)`),true);
  a.run(`undoPoint(event().matches.filter(m=>m.phase==='group').at(-1).id)`);
  assert.equal(a.run(`event().matches.some(m=>m.phase==='knockout')`),false);
});
test('undo reopens game-ending point, and match-ending point clears unstarted next round',()=>{
  const a=setup();
  a.run(`const m=event().matches[0];m.scoring={points:11,bestOf:3};for(let i=0;i<11;i++)addPoint(m.id,'a');undoPoint(m.id);`);
  assert.deepEqual(a.plain('event().matches[0].games'),[{a:10,b:0,complete:false}]);
  a.run(`event().matches[0].scoring.bestOf=1;addPoint(event().matches[0].id,'a');undoPoint(event().matches[0].id);`);
  assert.equal(a.run(`event().matches[0].status`),'live');
  assert.equal(a.run(`event().matches.find(m=>m.round==='Final').aId`),null);
});
test('undo blocks a result used by a started final; force award fabricates no score',()=>{
  const a=setup();
  a.run(`forceWin(event().matches[0].id,'a');forceWin(event().matches[1].id,'a');addPoint(event().matches.find(m=>m.round==='Final').id,'a');undoPoint(event().matches[0].id);`);
  assert.equal(a.run(`event().matches[0].status`),'completed');
  assert.equal(a.run(`scoreText(event().matches[0])`),'Awarded');
  assert.ok(a.messages.some(m=>m.includes('later matches')));
});
test('same court and players cannot be scored in simultaneous matches',()=>{
  const a=setup();
  a.run(`event().matches[0].court=1;event().matches[1].court=1;addPoint(event().matches[0].id,'a');addPoint(event().matches[1].id,'a');`);
  assert.equal(a.run(`event().matches[1].status`),'pending');
});
test('insufficient group entries do not generate an unusable draw',()=>{
  const a=setup(3);a.run(`event().format='groups4';generateDraw(event());`);
  assert.ok(a.messages.some(m=>m.includes('at least 8')));
});
