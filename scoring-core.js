(function(root){
  const scoring={
    gameWon(rule,g,side){const p=rule.points||21,cap=p===21?30:p+9;return (g[side]>=p&&g[side]-g[side==='a'?'b':'a']>=2)||g[side]>=cap;},
    neededWins(rule){return Math.floor((rule.bestOf||3)/2)+1;},
    point(m,side){
      const g=m.games.at(-1);m.status='live';g[side]++;
      if(this.gameWon(m.rule,g,side)){
        g.complete=true;g.winner=side;
        if(m.games.filter(x=>x.complete&&x.winner===side).length>=this.neededWins(m.rule)){m.status='completed';m.winner=side;}
        else m.games.push({a:0,b:0,complete:false});
      }
    }
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=scoring;else root.DropshotScoring=scoring;
})(globalThis);
