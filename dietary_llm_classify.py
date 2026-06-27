#!/usr/bin/env python3
"""
Dietary classification — PASS 2 (Claude API inference)
Fills the dimensions Google can't assert (keto, paleo, dairy_free, nut_aware)
and enriches gluten_free/halal/kosher beyond explicit labels.

Run with YOUR key (no key is present in the build sandbox):
    pip install anthropic pandas python-dotenv
    # put ANTHROPIC_API_KEY=sk-ant-... in a .env file next to this script
    python dietary_llm_classify.py

Discipline (per §2.7): strict-JSON out, batched, checkpointed/resumable,
defensive parse. Deterministic TRUE flags are preserved (never overridden).
NOTE: without review text (run was maxReviews:0), keto/paleo/dairy_free are
inferred from name+cuisine only -> lower confidence. Re-run after run-2 review
text for higher accuracy.
"""
import os, json, sys, time
import pandas as pd
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()  # reads ANTHROPIC_API_KEY from a .env file next to this script

SRC = "region4_enriched_dietary.csv"
OUT = "region4_enriched_dietary_final.csv"
CKPT = ".dietary_llm_ckpt.json"
MODEL = "claude-sonnet-4-6"
BATCH = 25
FLAGS = ["vegan","vegetarian","gluten_free","dairy_free","keto","paleo",
         "halal","kosher","organic","healthy","nut_aware","pescatarian"]
DET_PRESERVE = ["vegan","vegetarian","organic","healthy","halal","pescatarian","gluten_free","kosher"]

SYS = (
 "You classify restaurants into dietary-accommodation flags for a directory. "
 "A flag is TRUE if the restaurant plausibly OFFERS options for that diner, not only if it is exclusively that. "
 "Be conservative: default FALSE unless name/cuisine clearly supports it. "
 "halal/kosher: only TRUE if the cuisine/name strongly implies certification (e.g. explicitly halal, "
 "or cuisines like Afghan/Pakistani/Persian for halal); never assume from generic Mediterranean. "
 "Return ONLY a JSON array, no prose, no markdown fences. "
 'Each element: {"id": <int>, "keto": bool, "paleo": bool, "dairy_free": bool, "nut_aware": bool, '
 '"gluten_free": bool, "halal": bool, "kosher": bool}'
)

def parse(txt):
    txt = txt.strip()
    if txt.startswith("```"):
        txt = txt.strip("`")
        txt = txt[txt.find("["):]
    return json.loads(txt[txt.find("["): txt.rfind("]")+1])

def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("Set ANTHROPIC_API_KEY first.")
    client = Anthropic()
    df = pd.read_csv(SRC, dtype=str)
    done = json.load(open(CKPT)) if os.path.exists(CKPT) else {}
    todo = [i for i in range(len(df)) if str(i) not in done]
    print(f"{len(df)} rows, {len(todo)} to classify, {len(done)} already done")

    for start in range(0, len(todo), BATCH):
        idx = todo[start:start+BATCH]
        items = [{"id": i,
                  "name": df.at[i,"business_name"],
                  "cuisine": df.at[i,"cuisine"],
                  "category": df.at[i,"category"]} for i in idx]
        msg = "Classify these restaurants:\n" + json.dumps(items, ensure_ascii=False)
        for attempt in range(3):
            try:
                r = client.messages.create(model=MODEL, max_tokens=2000,
                        system=SYS, messages=[{"role":"user","content":msg}])
                for rec in parse(r.content[0].text):
                    done[str(rec["id"])] = {k: bool(rec.get(k, False))
                                            for k in ["keto","paleo","dairy_free","nut_aware",
                                                      "gluten_free","halal","kosher"]}
                break
            except Exception as e:
                print(f"  batch {start} attempt {attempt+1} failed: {e}")
                time.sleep(2*(attempt+1))
        json.dump(done, open(CKPT,"w"))
        print(f"  {len(done)}/{len(df)} done")

    # merge: preserve deterministic TRUE, fill the rest from LLM
    for i in range(len(df)):
        llm = done.get(str(i), {})
        for fl in ["keto","paleo","dairy_free","nut_aware"]:
            df.at[i, fl] = llm.get(fl, False)
        for fl in ["gluten_free","halal","kosher"]:
            if str(df.at[i, fl]).lower() != "true":      # don't override Google-explicit TRUE
                df.at[i, fl] = llm.get(fl, False)
    df.to_csv(OUT, index=False)
    print(f"\nwrote {OUT}")
    for fl in FLAGS:
        print(f"  {fl:12s}: {(df[fl].astype(str).str.lower()=='true').sum():5d}")

if __name__ == "__main__":
    main()
