/* ============================================================
 * 22-vendor-location-map.js
 * Real interactive vendor location map (Leaflet + OpenStreetMap
 * tiles) — pins each vendor from the Vendor Master's Factory
 * Location / Location column on an actual world map, with a
 * click-to-open popup (name, location, rating).
 * ------------------------------------------------------------
 * Part of the L&T Vendor Rating Dashboard application script.
 * These files share one global scope and MUST load in numeric
 * order (see the <script> tags in vendor_rating.html). Loads
 * right after 20-world-map.js, which still supplies the region
 * badge / doughnut breakdown used elsewhere on the Overview page.
 * ============================================================ */

// city / state / country name -> representative [lat, lng]. Ordered most
// specific (city) first, most general (country/region) last, so a lookup
// that scans top-to-bottom and stops at the first hit favours precision.
const GEO_POINTS = [
  // ---- India: cities ----
  {re:/\b(new\s*delhi|\bdelhi)\b/i, ll:[28.6139,77.2090]},
  {re:/\bnoida\b/i, ll:[28.5355,77.3910]},
  {re:/\b(gurugram|gurgaon)\b/i, ll:[28.4595,77.0266]},
  {re:/\bfaridabad\b/i, ll:[28.4089,77.3178]},
  {re:/\bghaziabad\b/i, ll:[28.6692,77.4538]},
  {re:/\bludhiana\b/i, ll:[30.9010,75.8573]},
  {re:/\bamritsar\b/i, ll:[31.6340,74.8723]},
  {re:/\bjalandhar\b/i, ll:[31.3260,75.5762]},
  {re:/\bpanipat\b/i, ll:[29.3909,76.9635]},
  {re:/\blucknow\b/i, ll:[26.8467,80.9462]},
  {re:/\bkanpur\b/i, ll:[26.4499,80.3319]},
  {re:/\bmeerut\b/i, ll:[28.9845,77.7064]},
  {re:/\bagra\b/i, ll:[27.1767,78.0081]},
  {re:/\bvaranasi\b/i, ll:[25.3176,82.9739]},
  {re:/\b(prayagraj|allahabad)\b/i, ll:[25.4358,81.8463]},
  {re:/\bjaipur\b/i, ll:[26.9124,75.7873]},
  {re:/\bjodhpur\b/i, ll:[26.2389,73.0243]},
  {re:/\budaipur\b/i, ll:[24.5854,73.7125]},
  {re:/\bkota\b/i, ll:[25.2138,75.8648]},
  {re:/\bshimla\b/i, ll:[31.1048,77.1734]},
  {re:/\bdehradun\b/i, ll:[30.3165,78.0322]},
  {re:/\b(hardiwar|haridwar)\b/i, ll:[29.9457,78.1642]},
  {re:/\bchandigarh\b/i, ll:[30.7333,76.7794]},
  {re:/\bsrinagar\b/i, ll:[34.0837,74.7973]},
  {re:/\bjammu\b/i, ll:[32.7266,74.8570]},
  {re:/\b(mumbai|bombay)\b/i, ll:[19.0760,72.8777]},
  {re:/\bpune\b/i, ll:[18.5204,73.8567]},
  {re:/\bnagpur\b/i, ll:[21.1458,79.0882]},
  {re:/\bnashik\b/i, ll:[19.9975,73.7898]},
  {re:/\bthane\b/i, ll:[19.2183,72.9781]},
  {re:/\baurangabad\b/i, ll:[19.8762,75.3433]},
  {re:/\bahmedabad\b/i, ll:[23.0225,72.5714]},
  {re:/\bsurat\b/i, ll:[21.1702,72.8311]},
  {re:/\b(vadodara|baroda)\b/i, ll:[22.3072,73.1812]},
  {re:/\brajkot\b/i, ll:[22.3039,70.8022]},
  {re:/\bgandhinagar\b/i, ll:[23.2156,72.6369]},
  {re:/\b(goa|panaji)\b/i, ll:[15.4909,73.8278]},
  {re:/\bbhopal\b/i, ll:[23.2599,77.4126]},
  {re:/\bindore\b/i, ll:[22.7196,75.8577]},
  {re:/\bgwalior\b/i, ll:[26.2183,78.1828]},
  {re:/\bjabalpur\b/i, ll:[23.1815,79.9864]},
  {re:/\b(kolkata|calcutta)\b/i, ll:[22.5726,88.3639]},
  {re:/\bhowrah\b/i, ll:[22.5958,88.2636]},
  {re:/\bsiliguri\b/i, ll:[26.7271,88.3953]},
  {re:/\bdurgapur\b/i, ll:[23.5204,87.3119]},
  {re:/\bbhubaneswar\b/i, ll:[20.2961,85.8245]},
  {re:/\bcuttack\b/i, ll:[20.4625,85.8830]},
  {re:/\bpatna\b/i, ll:[25.5941,85.1376]},
  {re:/\bgaya\b/i, ll:[24.7955,84.9994]},
  {re:/\branchi\b/i, ll:[23.3441,85.3096]},
  {re:/\bjamshedpur\b/i, ll:[22.8046,86.2029]},
  {re:/\bdhanbad\b/i, ll:[23.7957,86.4304]},
  {re:/\bguwahati\b/i, ll:[26.1445,91.7362]},
  {re:/\braipur\b/i, ll:[21.2514,81.6296]},
  {re:/\b(chennai|madras)\b/i, ll:[13.0827,80.2707]},
  {re:/\bcoimbatore\b/i, ll:[11.0168,76.9558]},
  {re:/\bmadurai\b/i, ll:[9.9252,78.1198]},
  {re:/\btrichy|tiruchirappalli\b/i, ll:[10.7905,78.7047]},
  {re:/\bsalem\b/i, ll:[11.6643,78.1460]},
  {re:/\b(bangalore|bengaluru)\b/i, ll:[12.9716,77.5946]},
  {re:/\b(mysore|mysuru)\b/i, ll:[12.2958,76.6394]},
  {re:/\bmangalore\b/i, ll:[12.9141,74.8560]},
  {re:/\bhubli\b/i, ll:[15.3647,75.1240]},
  {re:/\bhyderabad\b/i, ll:[17.3850,78.4867]},
  {re:/\bwarangal\b/i, ll:[17.9689,79.5941]},
  {re:/\b(kochi|cochin)\b/i, ll:[9.9312,76.2673]},
  {re:/\b(trivandrum|thiruvananthapuram)\b/i, ll:[8.5241,76.9366]},
  {re:/\bkozhikode\b/i, ll:[11.2588,75.7804]},
  {re:/\bthrissur\b/i, ll:[10.5276,76.2144]},
  {re:/\bvijayawada\b/i, ll:[16.5062,80.6480]},
  {re:/\b(visakhapatnam|vizag)\b/i, ll:[17.6868,83.2185]},
  {re:/\btirupati\b/i, ll:[13.6288,79.4192]},
  {re:/\b(puducherry|pondicherry)\b/i, ll:[11.9416,79.8083]},
  {re:/\bshillong\b/i, ll:[25.5788,91.8933]},
  // ---- India: state fallbacks (used only when no city above matched) ----
  {re:/\bpunjab\b/i, ll:[31.1471,75.3412]},
  {re:/\bharyana\b/i, ll:[29.0588,76.0856]},
  {re:/\b(uttar\s*pradesh|\bup)\b/i, ll:[26.8467,80.9462]},
  {re:/\brajasthan\b/i, ll:[26.9124,75.7873]},
  {re:/\bhimachal\b/i, ll:[31.1048,77.1734]},
  {re:/\buttarakhand\b/i, ll:[30.3165,78.0322]},
  {re:/\b(jammu|kashmir)\b/i, ll:[33.7782,76.5762]},
  {re:/\bmaharashtra\b/i, ll:[19.7515,75.7139]},
  {re:/\bgujarat\b/i, ll:[22.2587,71.1924]},
  {re:/\bmadhya\s*pradesh\b/i, ll:[23.4733,77.9470]},
  {re:/\b(west\s*bengal|bengal)\b/i, ll:[22.9868,87.8550]},
  {re:/\b(odisha|orissa)\b/i, ll:[20.9517,85.0985]},
  {re:/\bbihar\b/i, ll:[25.0961,85.3131]},
  {re:/\bjharkhand\b/i, ll:[23.6102,85.2799]},
  {re:/\bassam\b/i, ll:[26.2006,92.9376]},
  {re:/\bchhattisgarh\b/i, ll:[21.2787,81.8661]},
  {re:/\b(tamil\s*nadu|tamil)\b/i, ll:[11.1271,78.6569]},
  {re:/\bkarnataka\b/i, ll:[15.3173,75.7139]},
  {re:/\btelangana\b/i, ll:[18.1124,79.0193]},
  {re:/\bkerala\b/i, ll:[10.8505,76.2711]},
  {re:/\bandhra\b/i, ll:[15.9129,79.7400]},
  // ---- Middle East ----
  {re:/\briyadh\b/i, ll:[24.7136,46.6753]},
  {re:/\bjeddah\b/i, ll:[21.4858,39.1925]},
  {re:/\bjubail\b/i, ll:[27.0046,49.6604]},
  {re:/\bdammam\b/i, ll:[26.4207,50.0888]},
  {re:/\bkhobar\b/i, ll:[26.2794,50.2083]},
  {re:/\bdhahran\b/i, ll:[26.2361,50.0393]},
  {re:/\b(mecca|makkah)\b/i, ll:[21.3891,39.8579]},
  {re:/\bmedina\b/i, ll:[24.5247,39.5692]},
  {re:/\b(saudi|\bksa)\b/i, ll:[24.7136,46.6753]},
  {re:/\bdubai\b/i, ll:[25.2048,55.2708]},
  {re:/\babu\s*dhabi\b/i, ll:[24.4539,54.3773]},
  {re:/\bsharjah\b/i, ll:[25.3463,55.4209]},
  {re:/\bajman\b/i, ll:[25.4052,55.5136]},
  {re:/\bfujairah\b/i, ll:[25.1288,56.3265]},
  {re:/\bras\s*al\s*khaimah\b/i, ll:[25.7895,55.9432]},
  {re:/\b(uae|u\.a\.e)\b/i, ll:[24.4539,54.3773]},
  {re:/\b(doha|qatar)\b/i, ll:[25.2854,51.5310]},
  {re:/\b(muscat|oman)\b/i, ll:[23.5859,58.4059]},
  {re:/\b(manama|bahrain)\b/i, ll:[26.2285,50.5860]},
  {re:/\bkuwait\b/i, ll:[29.3759,47.9774]},
  {re:/\b(baghdad|iraq)\b/i, ll:[33.3152,44.3661]},
  {re:/\b(amman|jordan)\b/i, ll:[31.9454,35.9284]},
  {re:/\b(beirut|lebanon)\b/i, ll:[33.8938,35.5018]},
  {re:/\b(cairo|egypt|alexandria|giza)\b/i, ll:[30.0444,31.2357]},
  {re:/\b(tel\s*aviv|israel)\b/i, ll:[32.0853,34.7818]},
  // ---- China & East Asia ----
  {re:/\bshanghai\b/i, ll:[31.2304,121.4737]},
  {re:/\bbeijing\b/i, ll:[39.9042,116.4074]},
  {re:/\bshenzhen\b/i, ll:[22.5431,114.0579]},
  {re:/\bguangzhou\b/i, ll:[23.1291,113.2644]},
  {re:/\bhangzhou\b/i, ll:[30.2741,120.1551]},
  {re:/\btianjin\b/i, ll:[39.3434,117.3616]},
  {re:/\bchengdu\b/i, ll:[30.5728,104.0668]},
  {re:/\bwuhan\b/i, ll:[30.5928,114.3055]},
  {re:/\bnanjing\b/i, ll:[32.0603,118.7969]},
  {re:/\bxiamen\b/i, ll:[24.4798,118.0894]},
  {re:/\bqingdao\b/i, ll:[36.0671,120.3826]},
  {re:/\bsuzhou\b/i, ll:[31.2989,120.5853]},
  {re:/\bningbo\b/i, ll:[29.8683,121.5440]},
  {re:/\bdongguan\b/i, ll:[23.0430,113.7633]},
  {re:/\bfoshan\b/i, ll:[23.0218,113.1219]},
  {re:/\b(china|chinese)\b/i, ll:[35.8617,104.1954]},
  {re:/\b(hong\s*kong|\bhk\b)/i, ll:[22.3193,114.1694]},
  {re:/\b(taiwan|taipei)\b/i, ll:[25.0330,121.5654]},
  {re:/\btokyo\b/i, ll:[35.6762,139.6503]},
  {re:/\bosaka\b/i, ll:[34.6937,135.5023]},
  {re:/\byokohama\b/i, ll:[35.4437,139.6380]},
  {re:/\bjapan\b/i, ll:[36.2048,138.2529]},
  {re:/\bseoul\b/i, ll:[37.5665,126.9780]},
  {re:/\bbusan\b/i, ll:[35.1796,129.0756]},
  {re:/\bincheon\b/i, ll:[37.4563,126.7052]},
  {re:/\b(south\s*korea|korea)\b/i, ll:[35.9078,127.7669]},
  // ---- Southeast Asia ----
  {re:/\bsingapore\b/i, ll:[1.3521,103.8198]},
  {re:/\b(kuala\s*lumpur|malaysia)\b/i, ll:[3.1390,101.6869]},
  {re:/\bjohor\b/i, ll:[1.4854,103.7618]},
  {re:/\bpenang\b/i, ll:[5.4141,100.3288]},
  {re:/\b(bangkok|thailand)\b/i, ll:[13.7563,100.5018]},
  {re:/\bhanoi\b/i, ll:[21.0278,105.8342]},
  {re:/\bho\s*chi\s*minh\b/i, ll:[10.8231,106.6297]},
  {re:/\bvietnam\b/i, ll:[14.0583,108.2772]},
  {re:/\bjakarta\b/i, ll:[-6.2088,106.8456]},
  {re:/\bsurabaya\b/i, ll:[-7.2575,112.7521]},
  {re:/\bindonesia\b/i, ll:[-0.7893,113.9213]},
  {re:/\b(manila|philippines)\b/i, ll:[14.5995,120.9842]},
  {re:/\bcebu\b/i, ll:[10.3157,123.8854]},
  {re:/\bmyanmar\b/i, ll:[21.9162,95.9560]},
  {re:/\bcambodia\b/i, ll:[12.5657,104.9910]},
  {re:/\blaos\b/i, ll:[19.8563,102.4955]},
  // ---- Europe ----
  {re:/\b(london|england|united\s*kingdom|\bu\.?k\.?)\b/i, ll:[51.5072,-0.1276]},
  {re:/\bmanchester\b/i, ll:[53.4808,-2.2426]},
  {re:/\bbirmingham\b/i, ll:[52.4862,-1.8904]},
  {re:/\bberlin\b/i, ll:[52.5200,13.4050]},
  {re:/\bmunich\b/i, ll:[48.1351,11.5820]},
  {re:/\bfrankfurt\b/i, ll:[50.1109,8.6821]},
  {re:/\bhamburg\b/i, ll:[53.5511,9.9937]},
  {re:/\bstuttgart\b/i, ll:[48.7758,9.1829]},
  {re:/\bgermany\b/i, ll:[51.1657,10.4515]},
  {re:/\b(paris|france)\b/i, ll:[48.8566,2.3522]},
  {re:/\blyon\b/i, ll:[45.7640,4.8357]},
  {re:/\bmilan\b/i, ll:[45.4642,9.1900]},
  {re:/\b(rome|italy)\b/i, ll:[41.9028,12.4964]},
  {re:/\b(madrid|spain)\b/i, ll:[40.4168,-3.7038]},
  {re:/\bbarcelona\b/i, ll:[41.3874,2.1686]},
  {re:/\b(amsterdam|netherlands)\b/i, ll:[52.3676,4.9041]},
  {re:/\brotterdam\b/i, ll:[51.9225,4.4792]},
  {re:/\b(zurich|switzerland)\b/i, ll:[47.3769,8.5417]},
  {re:/\bgeneva\b/i, ll:[46.2044,6.1432]},
  {re:/\b(brussels|belgium)\b/i, ll:[50.8503,4.3517]},
  {re:/\b(stockholm|sweden)\b/i, ll:[59.3293,18.0686]},
  {re:/\b(oslo|norway)\b/i, ll:[59.9139,10.7522]},
  {re:/\b(copenhagen|denmark)\b/i, ll:[55.6761,12.5683]},
  {re:/\b(helsinki|finland)\b/i, ll:[60.1699,24.9384]},
  {re:/\b(warsaw|poland)\b/i, ll:[52.2297,21.0122]},
  {re:/\b(vienna|austria)\b/i, ll:[48.2082,16.3738]},
  {re:/\b(lisbon|portugal)\b/i, ll:[38.7223,-9.1393]},
  {re:/\b(dublin|ireland)\b/i, ll:[53.3498,-6.2603]},
  {re:/\b(athens|greece)\b/i, ll:[37.9838,23.7275]},
  {re:/\b(prague|czech)\b/i, ll:[50.0755,14.4378]},
  {re:/\b(budapest|hungary)\b/i, ll:[47.4979,19.0402]},
  {re:/\beurope\b/i, ll:[50.1109,10.0]},
  // ---- Americas ----
  {re:/\bnew\s*york\b/i, ll:[40.7128,-74.0060]},
  {re:/\blos\s*angeles\b/i, ll:[34.0522,-118.2437]},
  {re:/\bchicago\b/i, ll:[41.8781,-87.6298]},
  {re:/\bhouston\b/i, ll:[29.7604,-95.3698]},
  {re:/\bdallas\b/i, ll:[32.7767,-96.7970]},
  {re:/\bsan\s*francisco\b/i, ll:[37.7749,-122.4194]},
  {re:/\b(usa|u\.s\.a|united\s*states|america)\b/i, ll:[39.8283,-98.5795]},
  {re:/\btoronto\b/i, ll:[43.6532,-79.3832]},
  {re:/\bvancouver\b/i, ll:[49.2827,-123.1207]},
  {re:/\bcanada\b/i, ll:[56.1304,-106.3468]},
  {re:/\bmexico\b/i, ll:[23.6345,-102.5528]},
  {re:/\b(sao\s*paulo|brazil)\b/i, ll:[-23.5505,-46.6333]},
  {re:/\b(buenos\s*aires|argentina)\b/i, ll:[-34.6037,-58.3816]},
  {re:/\b(santiago|chile)\b/i, ll:[-33.4489,-70.6693]},
  {re:/\b(bogota|colombia)\b/i, ll:[4.7110,-74.0721]},
  // ---- Africa ----
  {re:/\bjohannesburg\b/i, ll:[-26.2041,28.0473]},
  {re:/\bcape\s*town\b/i, ll:[-33.9249,18.4241]},
  {re:/\bsouth\s*africa\b/i, ll:[-30.5595,22.9375]},
  {re:/\b(lagos|nigeria)\b/i, ll:[6.5244,3.3792]},
  {re:/\b(nairobi|kenya)\b/i, ll:[-1.2921,36.8219]},
  {re:/\b(casablanca|morocco)\b/i, ll:[33.5731,-7.5898]},
  {re:/\b(accra|ghana)\b/i, ll:[5.6037,-0.1870]},
  {re:/\b(addis\s*ababa|ethiopia)\b/i, ll:[9.0250,38.7469]},
];

// Resolve a free-text location string ("Coimbatore, Tamil Nadu", "UAE", ...)
// to a representative [lat, lng]. Returns null when nothing matches, so the
// caller can skip that vendor rather than pin it somewhere wrong.
function geocodeLocation(text){
  if(!text) return null;
  const hay = String(text);
  for(let i=0;i<GEO_POINTS.length;i++){ if(GEO_POINTS[i].re.test(hay)) return GEO_POINTS[i].ll; }
  return null;
}

// A vendor's overall score (0-100, from the same tiering used on the Vendor
// Focus page), its 0-5 "star" rating for the map popup, and the tier color/
// label used to color-code its pin. Null (not the platinum/gold/silver/bronze
// buckets) means "not yet tiered" — drawn as a neutral grey pin.
function vendorTierMeta(code){
  try{
    if(typeof computeVendorTiers!=='function') return null;
    const tiers = computeVendorTiers();
    const defs = {platinum:{c:'#5b4fcf',label:'Platinum'}, gold:{c:'#b58a1b',label:'Gold'},
                  silver:{c:'#5f6b75',label:'Silver'}, bronze:{c:'#a0592c',label:'Bronze'}};
    const buckets=['platinum','gold','silver','bronze'];
    for(let i=0;i<buckets.length;i++){
      const hit=(tiers[buckets[i]]||[]).find(v=>v.code===code);
      if(hit && Number.isFinite(hit.score)){
        const d=defs[buckets[i]];
        return {score:hit.score, out5:+(hit.score/100*5).toFixed(1), color:d.c, label:d.label};
      }
    }
  }catch(e){}
  return null;
}
const VPD_UNRATED_PIN_COLOR = '#93a1ab';

// Shared pin-color key, dropped under both the compact Overview map and the
// full World Map detail card so the tier colors on the pins are legible
// without having to click every one.
const VPD_TIER_LEGEND_HTML = `<div class="vpd-leaflet-legend">
  <span><i style="background:#5b4fcf"></i>Platinum</span>
  <span><i style="background:#b58a1b"></i>Gold</span>
  <span><i style="background:#5f6b75"></i>Silver</span>
  <span><i style="background:#a0592c"></i>Bronze</span>
  <span><i style="background:${VPD_UNRATED_PIN_COLOR}"></i>Not yet rated</span>
  <span class="sep">Every pin shows a number — 1 for a single vendor, more where several vendors sit at one spot; click to expand</span>
</div>`;

// Every distinct vendor with a resolvable location: Vendor Master roster
// first (works even before any PO tracker is loaded), then any vendor seen
// only in the PO data. One point per vendor code/name.
//
// allowedCodes, when passed, restricts the result to those vendor codes —
// this is how the map honours the Portfolio page's BU / vendor Analysis
// filters instead of always plotting every vendor regardless of scope.
// Pass undefined/null for the unfiltered "All BUs / All Vendors" case.
function collectVendorMapPoints(allowedCodes){
  const allowSet = allowedCodes ? new Set(allowedCodes.map(c=>String(c||'').trim()).filter(Boolean)) : null;
  const seen={}, pts=[];
  const pushPoint=(code,name,loc)=>{
    const key=(code||name||'').trim(); if(!key) return;
    if(allowSet && !allowSet.has((code||'').trim()) && !allowSet.has(key)) return;
    const nk=(typeof normVenKey==='function')?normVenKey(key):key.toLowerCase();
    if(seen[nk]) return; seen[nk]=1;
    const ll=geocodeLocation(loc); if(!ll) return;
    const tier = vendorTierMeta(code);
    pts.push({code:code||'', name:name||code||'Unnamed vendor', location:loc, lat:ll[0], lng:ll[1],
      rating: tier?tier.out5:null, tierColor: tier?tier.color:null, tierLabel: tier?tier.label:null});
  };
  Object.values((typeof VENDOR_MASTER_ROSTER!=='undefined'&&VENDOR_MASTER_ROSTER)||{}).forEach(v=>{
    pushPoint(v.code, v.name, v.location);
  });
  try{
    (typeof all==='function'?all():[]).forEach(i=>{
      const code=(i.vendor||'').trim(); if(!code) return;
      const loc = (typeof vendorLocationFor==='function') ? vendorLocationFor(i.vendor, i.vendorName) : '';
      if(loc) pushPoint(code, i.vendorName, loc);
    });
  }catch(e){}
  return pts;
}

// Groups map points that would render on top of each other at the map's
// CURRENT zoom/pan (compared by on-screen pixel distance, not raw lat/lng —
// two vendors a few km apart in the same metro area sit under one pixel at
// world zoom, so a raw-coordinate match alone isn't enough). Re-run on every
// 'zoomend' so clusters split apart as the user zooms in.
function _vpdPixelClusters(map, pts, thresholdPx){
  const items = pts.map(p=>({p, pt: map.latLngToContainerPoint([p.lat,p.lng])}));
  const used = new Array(items.length).fill(false);
  const clusters = [];
  for(let i=0;i<items.length;i++){
    if(used[i]) continue;
    const group=[items[i].p]; used[i]=true;
    for(let j=i+1;j<items.length;j++){
      if(used[j]) continue;
      const dx=items[i].pt.x-items[j].pt.x, dy=items[i].pt.y-items[j].pt.y;
      if(Math.sqrt(dx*dx+dy*dy) <= thresholdPx){ group.push(items[j].p); used[j]=true; }
    }
    clusters.push(group);
  }
  return clusters;
}

function _vpdSinglePopupHtml(p){
  const cityOnly = String(p.location||'').split(',')[0].trim();
  const ratingHtml = p.rating!=null
    ? `<span class="vpd-leaflet-pop-rating" style="background:${p.tierColor||VPD_UNRATED_PIN_COLOR}">${p.tierLabel?p.tierLabel+' · ':''}${p.rating} / 5</span>`
    : '';
  return `<div class="vpd-leaflet-pop">
    <div class="vpd-leaflet-pop-name">${hesc(p.name)}</div>
    <div class="vpd-leaflet-pop-loc">${hesc(cityOnly)}</div>
    ${ratingHtml}
  </div>`;
}

function _vpdClusterPopupHtml(group){
  const cityOnly = String(group[0].location||'').split(',')[0].trim();
  const rows = group.slice().sort((a,b)=>(b.rating||0)-(a.rating||0)).map(p=>{
    const dot = p.tierColor||VPD_UNRATED_PIN_COLOR;
    const ratingTxt = p.rating!=null?`${p.rating}/5`:'—';
    const openable = p.code && typeof openVendorPage==='function';
    return `<div class="vpd-leaflet-pop-row"${openable?` onclick="openVendorPage('${esc(p.code)}')"`:''} title="${hesc(p.name)}${openable?' — click to open vendor page':''}">
      <i style="background:${dot}"></i><span class="nm">${hesc(p.name)}</span><span class="sc">${ratingTxt}</span>
    </div>`;
  }).join('');
  return `<div class="vpd-leaflet-pop vpd-leaflet-pop-cluster">
    <div class="vpd-leaflet-pop-name">${group.length} vendors${cityOnly?` · ${hesc(cityOnly)}`:''}</div>
    <div class="vpd-leaflet-pop-list">${rows}</div>
  </div>`;
}

// containerId -> {map, resizeObserver}, so a re-render can tear down the previous map
// (and stop watching its old container) before the DOM node gets replaced.
const _vpdLeafletMaps = {};

function destroyVendorLocationMap(containerId){
  if(_vpdLeafletMaps[containerId]){
    const entry = _vpdLeafletMaps[containerId];
    try{ entry.resizeObserver && entry.resizeObserver.disconnect(); }catch(e){}
    try{ entry.map.remove(); }catch(e){}
    delete _vpdLeafletMaps[containerId];
  }
}

// Renders (or re-renders) a real, panable/zoomable vendor-location map into
// #<containerId>. opts.full=true gives the larger "World Map" detail-card
// version (scroll-to-zoom on, taller); the compact Overview panel omits
// scroll-zoom so the page itself stays scrollable.
//
// opts.vendorCodes, when supplied, restricts the pins to that list of vendor
// codes so the map honours whatever BU / vendor Analysis filter is active on
// the Portfolio page — omit it (undefined) for the unfiltered "All" view.
// opts.scopeLabel is the human-readable description of that same filter,
// shown in the badge so it's obvious the map IS scoped, not just sparse.
function renderVendorLocationMap(containerId, opts){
  opts = opts || {};
  const el = document.getElementById(containerId);
  if(!el || typeof L === 'undefined') return null;
  destroyVendorLocationMap(containerId);
  el.classList.remove('vpd-leaflet-offline'); // stale flag from a prior render of this container

  const pts = collectVendorMapPoints(opts.vendorCodes);
  const filtered = !!opts.vendorCodes;

  const map = L.map(el, {
    zoomControl: true,
    scrollWheelZoom: !!opts.full,
    attributionControl: true,
    // Half-step zoom (instead of Leaflet's default whole-integer snap) plus a lighter
    // wheel-to-zoom ratio makes scroll/pinch zooming feel like it glides between levels
    // rather than jumping — zoomAnimation itself is on by default, this just gives it
    // more steps to animate through.
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90
  }).setView([18, 30], opts.full ? 3 : 2);
  map.attributionControl.setPrefix(false);

  // The map engine itself (Leaflet, pins, clustering, popups, filtering) is fully local —
  // only this photo-tile imagery needs a live connection, and it's a nice-to-have on top of
  // pins that already work without it. Give up on tiles (rather than let a factory-floor
  // machine with no internet sit on a grid of broken image icons) once several tiles in a
  // row fail with none having ever succeeded, and fall back to a plain, clearly-labelled
  // offline background so the card still reads as "working", not "broken".
  //
  // CARTO Positron, not the raw OpenStreetMap "Standard" style: OSM's own tiles label each
  // place in its LOCAL script (Arabic for Saudi cities, Chinese characters for Chinese
  // cities, etc.) since that's what the underlying map data carries. Positron is built on
  // the same OSM data but renders every label in Latin/English, which is what a vendor
  // roster spanning India/Middle East/China/SE Asia actually needs to stay readable — and
  // its muted, near-monochrome palette (vs. Voyager's beige/pink/yellow land fills) keeps
  // the colored vendor pins and tier legend as the things that actually draw the eye on
  // this card, rather than competing with the basemap itself.
  // No errorTileUrl here on purpose: setting one previously broke offline detection below —
  // the fallback image is itself a real, always-successful image load, so Leaflet fired its
  // OWN 'tileload' success event for it just like a genuine tile, which permanently set
  // _tileOk=true on the very first failure and silently disabled the offline check for the
  // rest of the session. A genuinely-failed tile (no fallback) never reaches
  // .leaflet-tile-loaded, so the CSS below (img.leaflet-tile{opacity:0}, only fading in once
  // .leaflet-tile-loaded is added) hides the browser's broken-image icon just as well,
  // without faking a success.
  const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);
  let _tileOk = false, _tileErr = 0, _offline = false;
  tiles.on('tileload', ()=>{ _tileOk = true; });
  tiles.on('tileerror', ()=>{
    if(_offline || _tileOk) return;
    if(++_tileErr < 3) return;
    _offline = true;
    try{ map.removeLayer(tiles); }catch(e){}
    el.classList.add('vpd-leaflet-offline');
    const offlineCtl = L.control({position:'bottomleft'});
    offlineCtl.onAdd = function(){
      const div = L.DomUtil.create('div','vpd-leaflet-offline-note');
      div.textContent = 'Offline — showing vendor pins without map imagery';
      return div;
    };
    offlineCtl.addTo(map);
  });

  if(pts.length){
    try{
      const bounds = L.latLngBounds(pts.map(p=>[p.lat,p.lng]));
      map.fitBounds(bounds.pad(0.35), {maxZoom: opts.full ? 5 : 3, animate:false});
    }catch(e){}
  }

  const markersLayer = L.layerGroup().addTo(map);
  const clusterThreshold = opts.full ? 34 : 30;

  function draw(){
    markersLayer.clearLayers();
    // Light stagger on the pop-in (see vpdPinPop/vpdClusterPop, css/10-base.css) so a
    // freshly-drawn map fills in as a ripple rather than every pin popping at once —
    // capped so a page with hundreds of vendors doesn't take seconds to finish appearing.
    let _i = 0;
    _vpdPixelClusters(map, pts, clusterThreshold).forEach(group=>{
      const delay = Math.min(_i++ * 16, 260) + 'ms';
      // Single vendor and multi-vendor spots now share the same numbered-circle look
      // (previously a single vendor got a plain teardrop pin, colored grey whenever that
      // vendor wasn't yet rated — visually inconsistent with, and easy to miss next to,
      // the numbered cluster badges). A "1" badge, tier-colored the same way a teardrop
      // pin was, keeps every spot on the map reading the same way regardless of count.
      const lat = group.reduce((s,p)=>s+p.lat,0)/group.length;
      const lng = group.reduce((s,p)=>s+p.lng,0)/group.length;
      if(group.length === 1){
        const p = group[0];
        const size = 24;
        const icon = L.divIcon({
          className: 'vpd-leaflet-cluster',
          html: `<span class="vpd-leaflet-cluster-dot" style="width:${size}px;height:${size}px;background:${p.tierColor||VPD_UNRATED_PIN_COLOR};animation-delay:${delay}">1</span>`,
          iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor: [0, -size/2]
        });
        L.marker([p.lat, p.lng], {icon, title: p.name}).bindPopup(_vpdSinglePopupHtml(p)).addTo(markersLayer);
      } else {
        const size = Math.min(40, 24 + group.length);
        const icon = L.divIcon({
          className: 'vpd-leaflet-cluster',
          html: `<span class="vpd-leaflet-cluster-dot" style="width:${size}px;height:${size}px;animation-delay:${delay}">${group.length}</span>`,
          iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor: [0, -size/2]
        });
        L.marker([lat, lng], {icon, title: `${group.length} vendors`}).bindPopup(_vpdClusterPopupHtml(group)).addTo(markersLayer);
      }
    });
  }
  draw();
  map.on('zoomend', draw);

  // Leaflet only measures its container once, at creation. The compact card spans the
  // full width of the Portfolio band (css/10-base.css, .vpd-map-card) and the page's entrance
  // animation (motion.js) can still be resizing/settling that grid after this point, so a
  // single fixed-delay re-measure was a guess that didn't always land after the real final
  // size — the map then kept rendering tiles for a smaller, stale width, leaving blank gaps
  // at the right/bottom edge. Watching the container directly re-measures on every actual
  // size change instead (grid settling, window resize, sidebar toggle, ...), so the tiles
  // always cover the card exactly regardless of what caused the resize or when it happens.
  let resizeObserver = null;
  if(typeof ResizeObserver !== 'undefined'){
    resizeObserver = new ResizeObserver(()=>{ try{ map.invalidateSize(); draw(); }catch(e){} });
    resizeObserver.observe(el);
  }
  _vpdLeafletMaps[containerId] = { map, resizeObserver };

  const badge = opts.badgeId ? document.getElementById(opts.badgeId) : null;
  if(badge){
    const base = `${pts.length} vendor${pts.length===1?'':'s'} mapped`;
    badge.textContent = opts.scopeLabel ? `${base} — ${opts.scopeLabel}` : base;
  }

  const hint = opts.hintId ? document.getElementById(opts.hintId) : null;
  if(hint){
    hint.style.display = pts.length ? 'none' : '';
    if(!pts.length && filtered){
      hint.innerHTML = 'No vendors in the current <b>BU / Vendor</b> selection have a location on file. Clear the filter above the Analysis charts, or add a Location for these vendors in the Vendor Master.';
    } else if(!pts.length){
      hint.innerHTML = 'Add a <b>Location</b> (city / state, or a country / region for overseas vendors) to each vendor in the Vendor Master to populate this map.';
    }
  }

  // Belt-and-suspenders for the (rare, pre-2020-browser) case with no ResizeObserver above:
  // one immediate re-measure in case the container was 0x0 at the moment Leaflet first
  // measured it.
  setTimeout(()=>{ try{ map.invalidateSize(); draw(); }catch(e){} }, 80);

  return {map, count: pts.length};
}
