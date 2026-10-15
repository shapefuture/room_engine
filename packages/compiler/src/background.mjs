// Corpus-derived "background word" model (Gries' DP dispersion).
//
// The problem: offline, with no reference corpus, how do we know "кажется" is a
// boring word and "Минерва" is not? Frequency alone says the opposite. The
// answer is *dispersion*: generic words smear evenly across every conversation,
// meaningful words burst into the conversations that are about them. This is
// Gries' deviation of proportions.
//
// Exact port of B's `compiler/src/background.py` (class Background, 29-96) —
// ground truth for the M2 merge (MERGE_PLAN §2.2). Pure JS, Map-based, dp cached
// per word. Its numpy import is unused by this class in B, so none is needed.

export const GENERIC_RANK = 700; // top-band words are function/filler vocabulary
export const DP_FLOOR = 0.72;    // below this dispersion a word looks "smeared"
export const DF_CEILING = 0.20;  // ...but only if it spans >20% of episodes

export class Background{
  constructor(tokensPerEpisode){
    this.nEp = Math.max(1,tokensPerEpisode.length);
    this.total = new Map();               // word -> total count
    this.epCounts = new Map();            // word -> Map(eid -> count)
    this.epSizes = [];
    for(let eid=0;eid<tokensPerEpisode.length;eid++){
      const toks=tokensPerEpisode[eid];
      this.epSizes.push(Math.max(1,toks.length));
      const c=new Map();
      for(const w of toks)c.set(w,(c.get(w)||0)+1);
      for(const [w,k] of c){
        this.total.set(w,(this.total.get(w)||0)+k);
        if(!this.epCounts.has(w))this.epCounts.set(w,new Map());
        this.epCounts.get(w).set(eid,k);
      }
    }
    this.corpusSize = Math.max(1,this.epSizes.reduce((a,b)=>a+b,0));
    this.expected = this.epSizes.map(s=>s/this.corpusSize);
    this._dp = new Map();
    // Zipf rank over insertion-ordered entries; stable sort keeps first-seen
    // order for count ties (matches Python Counter.most_common()).
    const entries=[...this.total.entries()];
    entries.sort((a,b)=>b[1]-a[1]);
    this.rank = new Map(entries.map(([w],i)=>[w,i]));
    this.vocab = Math.max(1,this.rank.size);
  }

  dp(w){
    if(this._dp.has(w))return this._dp.get(w);
    const tot=this.total.get(w)||0;
    if(tot===0)return 0.0;
    const counts=this.epCounts.get(w);
    let s=0;
    for(let eid=0;eid<this.expected.length;eid++){
      const obs=(counts.get(eid)||0)/tot;
      s+=Math.abs(obs-this.expected[eid]);
    }
    const v=s/2.0;
    this._dp.set(w,v);
    return v;
  }

  dfFrac(w){return (this.epCounts.get(w)?.size||0)/this.nEp;}

  rankOf(w){return this.rank.get(w)??this.vocab;}

  // Generic = a top-band word, or one smeared evenly across the corpus.
  isGeneric(w,dpFloor=DP_FLOOR,dfCeiling=DF_CEILING){
    if((this.total.get(w)||0)<3)return true;
    if(this.rankOf(w)<GENERIC_RANK)return true;
    return this.dp(w)<dpFloor&&this.dfFrac(w)>dfCeiling;
  }

  // 0 = commonest word in the corpus, 1 = hapax.
  rarity(w){return this.rankOf(w)/this.vocab;}

  // How much this word marks a particular conversation. B returns 0 for
  // hapax-ish words (total<2); kept for exact fidelity.
  specificity(w){
    const tot=this.total.get(w)||0;
    if(tot<2)return 0.0;
    return this.dp(w)*Math.log1p(tot)*(0.35+this.rarity(w));
  }
}
