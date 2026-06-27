#!/usr/bin/env python3
"""
Dietary classification — PASS 1 (deterministic, high precision)
Fills dietary flags from Google `additionalInfo` offerings + category/name.
Dimensions Google cannot assert (keto, paleo, dairy_free, nut_aware, and
gluten_free/halal/kosher where not explicit) are left for the LLM pass.

12 Central Florida dietary filters (tuned per §2.4/§12; kosher kept but light):
  vegan, vegetarian, gluten_free, dairy_free, keto, paleo,
  halal, kosher, organic, healthy, nut_aware, pescatarian
"""
import json, glob, re
import pandas as pd

UP, OUT = "/mnt/user-data/uploads", "/mnt/user-data/outputs"
FLAGS = ["vegan","vegetarian","gluten_free","dairy_free","keto","paleo",
         "halal","kosher","organic","healthy","nut_aware","pescatarian"]
# which flags the deterministic pass can decide; rest -> LLM
DET = {"vegan","vegetarian","organic","healthy","halal","pescatarian","gluten_free","kosher"}
LLM_ONLY = [f for f in FLAGS if f not in DET]   # keto, paleo, dairy_free, nut_aware

# ---- gather per-searchString Google signal ----
recs=[]
for f in glob.glob(f"{UP}/dataset_crawler-google-places_*.json"):
    recs+=json.load(open(f))
sig={}
for r in recs:
    ss=r.get("searchString","")
    ai=r.get("additionalInfo") or {}
    offers=set()
    for grp in ("Offerings","Highlights","From the business"):
        for item in (ai.get(grp) or []):
            offers|={k for k,v in item.items() if v}
    cats=" ".join([str(r.get("categoryName") or "")]+[str(c) for c in (r.get("categories") or [])]).lower()
    name=str(r.get("title") or "").lower()
    sig[ss]={"offers":offers,"cats":cats,"name":name}

m=pd.read_csv(f"{OUT}/apify_query_to_license_map.csv", dtype=str)
ss2lic=dict(zip(m["apify_search_query"], m["license_key"]))

def classify(s):
    o, cats, name = s["offers"], s["cats"], s["name"]
    txt = cats+" "+name
    f={k:None for k in FLAGS}  # None = undecided (LLM may fill)
    # explicit deterministic positives
    if "Vegan options" in o or "vegan" in txt: f["vegan"]=True
    if "Vegetarian options" in o or "vegetarian" in txt or f["vegan"]: f["vegetarian"]=True
    if {"Organic dishes","Organic products"} & o or "organic" in txt: f["organic"]=True
    if {"Healthy options","Salad bar"} & o or any(w in txt for w in
        ["juice","acai","açaí","salad","health food","smoothie","poke bowl","poke"]): f["healthy"]=True
    if "Halal food" in o or "halal" in txt: f["halal"]=True
    if "kosher" in txt: f["kosher"]=True
    if "gluten" in txt: f["gluten_free"]=True
    if any(w in cats for w in ["seafood","sushi","fish ","oyster","crab","poke"]): f["pescatarian"]=True
    return f

def cuisine(s):
    c=s["cats"]
    for cu in ["mexican","italian","chinese","japanese","thai","indian","mediterranean",
               "vietnamese","korean","american","seafood","pizza","bbq","steak","cuban",
               "caribbean","greek","french","sushi","cafe","bakery","vegan"]:
        if cu in c: return cu
    return "other"

enr=pd.read_csv(f"{OUT}/region4_enriched_establishments.csv", dtype=str)
rows=[]
for ss,s in sig.items():
    lic=ss2lic.get(ss)
    if not lic: continue
    f=classify(s); f["license_key"]=lic; f["cuisine"]=cuisine(s)
    f["has_google_offerings"]=len(s["offers"])>0
    rows.append(f)
d=pd.DataFrame(rows).drop_duplicates("license_key")
out=enr.merge(d, on="license_key", how="left")

# finalize: deterministic dims -> clean bool; LLM-only dims -> 'pending'
for fl in DET:
    out[fl]=out[fl].apply(lambda v: True if v is True else False)
for fl in LLM_ONLY:
    out[fl]="pending"
out.to_csv(f"{OUT}/region4_enriched_dietary.csv", index=False)

print(f"classified establishments: {len(d):,}")
print(f"have Google offerings data: {int(d['has_google_offerings'].sum()):,} "
      f"({100*d['has_google_offerings'].mean():.0f}%)")
print("\nDETERMINISTIC POSITIVES (high precision):")
for fl in sorted(DET):
    n=(d[fl]==True).sum()
    print(f"  {fl:12s}: {n:5d}  ({100*n/len(d):4.1f}%)")
print("\nLLM-ONLY dimensions (left undecided for pass 2):", ", ".join(LLM_ONLY))
print("\ntop cuisines:")
print(d["cuisine"].value_counts().head(12).to_string())
