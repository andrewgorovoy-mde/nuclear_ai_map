// =====================================================================================
//  STORY CONTENT — edit this file to change the narrative. No code changes needed for:
//    • text            → steps[].html (plain HTML; <b>, <em>, <span class="num"> are styled)
//    • timeline span   → timeline: { from, to }   (decimal years: 1945.5 = mid-1945)
//    • camera          → camera: { center: [lat, lng], zoom }   (per chapter, or per step)
//    • what's on map   → layers: { layerId: { ...options } }    (ids are defined in layers.js)
//    • image           → steps[].image: { src, caption, credit }  (files in story/img/)
//    • time feel       → ease: "accelerate" (optional)
//    • interlude       → interlude: { milestones, transistors } turns the stage into a time-lapse
//    • cursor reveal   → lens: "satellite" | "none"
//    • layer tags      → tags: one or more of TAGS below (drawn as the layer stack)
//  Dev helpers: story.html?chapter=3 jumps to a chapter; ?debug shows progress/year.
// =====================================================================================

// The six layers of interest, from physical to intangible (see the reference legend).
export const TAGS = {
  infrastructure: { label: "Infrastructure", style: "hatch" },
  people: { label: "People", style: "stripes" },
  environment: { label: "Environment & land use", style: "gradient" },
  land: { label: "Land, water & sacred places", style: "solid" },
  decisions: { label: "Decisions", style: "fill-accent" },
  community: { label: "Community", style: "dashed-accent" }
};

// "How to read this map": shown between the cover and chapter 1. Each item = one numbered block.
export const EXPLAINER = {
  title: "How to read this map",
  items: [
    { title: "Scroll", sub: "The text drives the map. Each chapter runs its own clock, with a clear start and end.", chips: ["Scroll", "Chapter timeline", "Start → end"] },
    { title: "Hover", sub: "Move the cursor over the map to open cells of satellite imagery onto the ground.", chips: ["Hover", "Satellite cells", "❝ Testimony"] },
    { title: "Marks", sub: "Two kinds of marks: hard lines for things that were recorded, soft glows for zones of impact.", chips: ["Ink line = recorded geometry", "Glow = zone of impact", "Dashed = approximate"] },
    { title: "Layers", sub: "Every chapter is tagged by what it is about, from physical systems to the people around them.", chips: ["Infrastructure", "People", "Environment & land use", "Land, water & sacred places", "Decisions", "Community"] },
    { title: "Tools", sub: "At the end, the full map is yours to explore.", chips: ["Filter", "Zoom", "Replay 1910–2025", "Click for sources"] }
  ]
};

// =====================================================================================
//  TESTIMONIES — real, attributed quotes, shown when the reader hovers a site during the
//  listed chapters. Kept short and few on purpose. Wording is exactly as published at `url`.
//  To add one: { place (a PLACES key), chapters: [chapter ids], speaker, year, text, source, url }.
// =====================================================================================
export const TESTIMONIES = [
  {
    place: "robertsville", chapters: ["taking"],
    speaker: "Reba Holmberg, whose family farmed at Robertsville", year: 2005,
    text: "We were very poorly paid for the land",
    source: "Voices of the Manhattan Project (AHF)", url: "https://ahf.nuclearmuseum.org/voices/oral-histories/reba-holmbergs-interview"
  },
  {
    place: "oakRidgeTown", chapters: ["hutments"],
    speaker: "Mrs. R. L. Ayers, who came to Oak Ridge in 1943 and lived in the hutments", year: null,
    text: "Black people had huts to live in and that was it for the Black people.",
    source: "National Park Service", url: "https://www.nps.gov/articles/000/-h-our-history-lesson-african-american-life-in-wwii-oak-ridge-tn.htm"
  },
  {
    place: "y12", chapters: ["plants"],
    speaker: "Ruth Huddleston, Y-12 calutron operator", year: 2018,
    text: "…we didn't know what on earth we would be helping do.",
    source: "Voices of the Manhattan Project (AHF)", url: "https://ahf.nuclearmuseum.org/voices/oral-histories/ruth-huddlestons-interview"
  },
  {
    place: "colossus1", chapters: ["colossus", "downwind", "air"],
    speaker: "Alexis Humphreys, Boxtown resident, at the county health department hearing", year: 2025,
    text: "I can't breathe at home, it smells like gas outside.",
    source: "E&E News", url: "https://www.eenews.net/articles/elon-musks-xai-in-memphis-35-gas-turbines-no-air-pollution-permits/"
  },
  {
    place: "southaven", chapters: ["hum"],
    speaker: "Devan Jenkins, whose family has lived nearby for five generations, at the state permit hearing", year: 2026,
    text: "…deep, constant drone that vibrates in your house.",
    source: "Mississippi Today, via the Tri-State Defender", url: "https://tri-statedefender.com/southaven-residents-oppose-xai-air-permit-for-41-natural-gas-turbines-at-public-hearing/02/21/"
  }
];

export const META = {
  title: "The Counter Map",
  subtitle: "TVA, source of paradigm-shift energy",
  exploreUrl: "explore.html"
};

// Reusable places (lat, lng). Sources: Wikipedia / NPS / AHF, compiled 2026-10-28.
export const PLACES = {
  y12: [35.9883, -84.2547],
  k25: [35.9322, -84.3950],
  x10: [35.9281, -84.3175],
  s50: [35.9161, -84.4119],
  wheat: [35.9367, -84.3736],
  robertsville: [36.0136, -84.2744],
  scarboro: [35.9844, -84.2208],
  elza: [36.0526, -84.2030],
  losAlamos: [35.8806, -106.3039],
  lamy: [35.4834, -105.8800],
  chicago: [41.7925, -87.6011],
  hanford: [46.6303, -119.6472],
  trinity: [33.6773, -106.4754],
  norris: [36.2244, -84.0917],
  wattsBar: [35.6211, -84.7817],
  colossus1: [35.05991, -90.15632],
  colossus2: [34.99798, -90.03487],
  southaven: [34.98203, -90.04071],
  memphisNcore: [35.1517, -89.8502],
  memphisAirport: [35.0424, -89.9767],
  efpcLabel: [36.003, -84.248],
  oakRidgeTown: [36.0104, -84.2696]
};

export const CHAPTERS = [
  {
    id: "intro",
    title: "Two campuses, eighty years apart",
    tags: ["decisions"],
    timeline: { from: 1942, to: 2026 },
    camera: { center: [35.6, -87.4], zoom: 6.3 },
    lens: "satellite",
    layers: { tvaZone: {}, sitePins: { show: ["oakRidge", "colossus"] } },
    steps: [
      { image: { src: "story/img/k25-aerial-1945.jpg", caption: "K-25, the gaseous-diffusion plant, 1945", credit: "U.S. Army / Manhattan Engineer District, public domain" }, html: `<p class="lead">In 1942 the U.S. Army took a valley in East Tennessee and, in under three years, built a secret city to enrich uranium.</p>` },
      { image: { src: "story/img/colossus1-sat.jpg", caption: "Colossus 1, the former Electrolux plant in southwest Memphis", credit: "Satellite: Esri World Imagery" }, html: `<p class="lead">In 2024 a company built one of the world's largest AI clusters in a Memphis warehouse in 122 days.</p><p>Both arrived fast, both drew enormous power from the same public grid, and both left marks on the land and the people around them. One was a war. The other is a market.</p>` }
    ]
  },
  {
    id: "taking",
    title: "A city that wasn't on the map",
    tags: ["people", "land"],
    timeline: { from: 1942.7, to: 1943.1 },
    camera: { center: [35.97, -84.29], zoom: 11.2 },
    lens: "satellite",
    layers: { reservation: {}, displacement: {} },
    steps: [
      { html: `<p>On <b>September 19, 1942</b>, General Leslie Groves approved a site in Roane and Anderson counties: about <span class="num">59,000 acres</span>, 17 miles long. Roane County lost about an eighth of its land.</p>` },
      { image: { src: "story/img/elza-gate-1945.jpg", caption: "Elza Gate, one of the guarded entrances to the reservation, 1945", credit: "Ed Westcott / U.S. Army, public domain" }, html: `<p>Roughly <span class="num">1,000 families</span> lived there. Most were given about six weeks to leave, some two. Some notices were nailed to fence posts. The Army paid for land, not for moving.</p>` },
      { html: `<p>Wheat, Robertsville, Scarboro and Elza ceased to exist. Some families had already been moved once, for Norris Dam or the Smokies.</p><p class="note">Reservation outline is approximate. Displacement figures vary by source (about 3,000–4,000 people).</p>` }
    ]
  },
  {
    id: "hutments",
    title: "Who was let in",
    tags: ["people", "community", "decisions"],
    timeline: { from: 1943, to: 1950 },
    camera: { center: [35.98, -84.27], zoom: 11.4 },
    lens: "satellite",
    layers: { reservation: { faint: true }, oakRidgePlants: {} },
    steps: [
      { html: `<p>About a thousand families were moved off the land. In their place came tens of thousands of workers, and the Army sorted them by race.</p>` },
      { image: { src: "story/img/hutments-1946.jpg", caption: "Hutments, Oak Ridge, 1946", credit: "Ed Westcott / U.S. Army, public domain" },
        html: `<p>Black workers, recruited largely for construction and heavy labor, were housed in <b>hutments</b>: 16 × 16 ft plywood huts with a central oil stove, four to six people each, one bathhouse for every 12 huts. Family hutments had no electricity or running water.</p>` },
      { html: `<p>Black women's quarters were fenced, with a 10 p.m. curfew; residents called it "the pen." A planned "Negro Village" was given to white residents instead. After the war, Black residents were confined to a new segregated neighborhood, also named Scarboro.</p><p class="note">Sources: NPS (African American Hutments), Tennessee Encyclopedia. Hutment locations are not yet mapped.</p>` }
    ]
  },
  {
    id: "plants",
    title: "Four plants, one product",
    tags: ["infrastructure"],
    timeline: { from: 1943, to: 1945.7 },
    camera: { center: [35.955, -84.32], zoom: 11.6 },
    lens: "satellite",
    layers: { reservation: { faint: true }, oakRidgePlants: {}, tvaPower: {} },
    steps: [
      { image: { src: "story/img/y12-alpha-track.jpg", caption: "An Alpha calutron \"racetrack\" at Y-12: magnets wound in Treasury silver", credit: "Ed Westcott / U.S. Army, public domain" }, html: `<p><b>Y-12</b> (Feb 1943) separated uranium-235 electromagnetically, with racetracks of <em>calutrons</em> wound in 14,700 tons of borrowed Treasury silver. It was not a reactor.</p>` },
      { image: { src: "story/img/x10-face.jpg", caption: "Loading face of the X-10 Graphite Reactor", credit: "Ed Westcott / U.S. Army, public domain" }, html: `<p>The <b>X-10 Graphite Reactor</b> went critical on <b>November 4, 1943</b>. <b>K-25</b>, a gaseous-diffusion plant nearly a mile around its U-shape, was the largest building in the world. <b>S-50</b> went up in 69 days.</p>` },
      { image: { src: "story/img/calutron-girls-1944.jpg", caption: "Calutron operators at Y-12, 1944", credit: "Ed Westcott / U.S. Army, public domain" }, camera: { center: [35.93, -84.42], zoom: 9.3 }, html: `<p>By 1945 Oak Ridge held about <span class="num">75,000</span> people. TVA hydro from Norris and Watts Bar dams fed the plants. At peak the site drew roughly <span class="num">1%</span> of U.S. electricity.</p>` }
    ]
  },
  {
    id: "courier",
    title: "Courier to Los Alamos",
    tags: ["decisions", "infrastructure"],
    timeline: { from: 1942.9, to: 1945.6 },
    camera: { center: [38.5, -98], zoom: 4.6 },
    lens: "none",
    layers: { manhattanNetwork: {} },
    steps: [
      { html: `<p>Oak Ridge was one node in a network: Chicago's pile went critical in December 1942, Los Alamos opened in January 1943, Hanford's B Reactor started in September 1944.</p>` },
      { html: `<p>Enriched uranium left Y-12 by hand. The first <span class="num">200 g</span> went in March 1944 in a case on an officer's arm. From 1945, couriers rode the train to Chicago, then the Santa Fe Chief to Lamy, New Mexico.</p><p class="note">Route detail from one courier memoir; another courier disputed parts of it.</p>` },
      { image: { src: "story/img/trinity-color.jpg", caption: "The Trinity test, July 16, 1945", credit: "NNSA, public domain" }, html: `<p>On <b>July 16, 1945</b> the Trinity test lit the New Mexico desert with Hanford plutonium. The bomb dropped on Hiroshima three weeks later used Oak Ridge uranium.</p>` }
    ]
  },
  {
    id: "mercury",
    title: "What the creek remembers",
    tags: ["environment", "land"],
    timeline: { from: 1950, to: 2026 },
    camera: { center: [35.99, -84.27], zoom: 12.3 },
    lens: "satellite",
    layers: { oakRidgePlants: { only: ["y12"] }, mercury: {} },
    steps: [
      { html: `<p>From 1950 to 1963 Y-12 used about <span class="num">11 million kg</span> of mercury to separate lithium for hydrogen bombs.</p>` },
      { image: { src: "story/img/efpc-y12-sat.jpg", caption: "Y-12 today, with East Fork Poplar Creek leaving the plant", credit: "Satellite: Esri World Imagery" }, html: `<p>Estimates of what escaped into air, soil and East Fork Poplar Creek range from <span class="num">330,000 kg</span> to <span class="num">733,000 lb</span>, with hundreds of tonnes more unaccounted for. The public learned in <b>1983</b>.</p>` },
      { html: `<p>The reservation was listed as a Superfund site in <b>1989</b>. Creek concentrations have fallen about 85%, but mercury in fish has not. The state still advises: do not eat fish from the creek.</p>` }
    ]
  },
  {
    id: "valley",
    title: "The valley lights up",
    tags: ["community", "infrastructure"],
    timeline: { from: 1933, to: 1985 },
    camera: { center: [35.5, -86.6], zoom: 7 },
    lens: "none",
    layers: { gridGrowth: {}, capacityHeat: {} },
    steps: [
      { image: { src: "story/img/norris-workers-1933.jpg", caption: "Workers at the Norris Dam site, 1933", credit: "TVA / National Archives, public domain" }, html: `<p>The war was also an electrification. In 1933 about <span class="num">3%</span> of Tennessee Valley farms had power.</p>` },
      { html: `<p>By 1945 TVA generated about <span class="num">12 billion kWh</span> a year, two-thirds for war industry, sold at roughly half the national rate. The lines kept spreading after the war.</p>` },
      { html: `<p class="note">The glow shows generating capacity in service, not electricity used per person. Per-capita consumption by county is the next data layer.</p>` }
    ]
  },
  {
    id: "shift",
    title: "Another paradigm",
    tags: ["infrastructure", "decisions"],
    timeline: { from: 1945, to: 2024 },
    ease: "accelerate",          // time speeds up as you scroll
    camera: { center: [37.5, -92], zoom: 4.4 },
    lens: "none",
    layers: { tvaZone: {} },
    // Full-stage animation: a year counter, these milestones, and transistors per chip.
    interlude: {
      milestones: [
        [1946, "ENIAC unveiled", "a room-sized electronic computer"],
        [1947, "Transistor", "Bell Labs"],
        [1958, "Integrated circuit", "Texas Instruments"],
        [1969, "ARPANET", "the first packet network"],
        [1971, "Microprocessor", "Intel 4004, 2,300 transistors"],
        [1991, "World Wide Web", "goes public"],
        [2007, "Smartphone", "computing in a pocket"],
        [2012, "Deep learning", "neural networks trained on GPUs"],
        [2017, "Transformer", "the architecture behind today's AI"],
        [2022, "ChatGPT", "AI reaches the public"],
        [2024, "Colossus", "100,000 GPUs in Memphis"]
      ],
      // Transistors on a single chip (log-interpolated between these points).
      transistors: [[1947, 1], [1971, 2300], [1993, 3.1e6], [2010, 2.0e9], [2022, 8.0e10], [2024, 2.08e11]]
    },
    steps: [
      { html: `<p class="lead">The war ended. The plants kept running. And the frontier of technology moved on, from the atom to the transistor.</p>` },
      { html: `<p>Computers shrank from rooms to chips to pockets. Each generation needed less power per calculation and, in total, far more of it.</p>` },
      { camera: { center: [35.06, -90.1], zoom: 9.5 }, html: `<p class="lead">Then models began to learn from almost everything. By 2024 the bottleneck was no longer chips. It was electricity, again, and the valley that once made it for the bomb.</p>` }
    ]
  },
  {
    id: "colossus",
    title: "122 days",
    tags: ["infrastructure", "decisions", "environment"],
    timeline: { from: 2024.3, to: 2026.6 },
    camera: { center: [35.03, -90.1], zoom: 11.4 },
    lens: "satellite",
    layers: { colossus: {} },
    steps: [
      { html: `<p>On <b>September 2, 2024</b>, Elon Musk announced xAI's Colossus in Memphis: 100,000 GPUs, "done in 122 days," in a former Electrolux plant.</p>` },
      { html: `<p>The grid could not keep up. The site began with <span class="num">8 MW</span>; TVA approved <span class="num">150 MW</span> in November 2024. Meanwhile up to <span class="num">35</span> gas turbines ran on site, most without permits, according to the NAACP's complaint; aerial photos in April 2025 showed 35.</p>` },
      { image: { src: "story/img/southaven-sat.jpg", caption: "The Southaven turbine yard, on the former Duke Energy site", credit: "Satellite: Esri World Imagery" }, html: `<p>Colossus 2 followed. Across the state line in Southaven, Mississippi, the turbine yard grew from <span class="num">18 units</span> in August 2025 to <span class="num">69</span> by July 15, 2026, by the state's own inventory. Mississippi let them run as temporary "mobile sources"; in October 2026 a federal judge, letting the NAACP's suit go forward, said that exemption does not fit. No court has ruled on liability.</p>` },
      { camera: { center: [35.08, -90.0], zoom: 10.6 }, html: `<p>Memphis's 2025 ozone reading, <span class="num">74 ppb</span>, was the only monitor in the TVA zone above the standard. The turbines hum day and night beside homes.</p><p class="note">Impact zones are illustrative radii, not modeled plumes or noise contours.</p>` }
    ]
  },
  {
    id: "downwind",
    title: "Who lives downwind",
    tags: ["people", "community", "decisions"],
    timeline: { from: 2024.5, to: 2026.6 },
    camera: { center: [35.03, -90.09], zoom: 11 },
    lens: "satellite",
    layers: { raceTracts: {}, colossus: { quiet: true } },
    steps: [
      { html: `<p>Colossus 1 sits in southwest Memphis, near Boxtown and Westwood, in an industrial corridor that already held a steel mill, an oil refinery and a gas-fired power plant.</p>` },
      { html: `<p>In the census tracts within three miles of it, <span class="num">92%</span> of residents are Black. Shelby County is <span class="num">52%</span> Black; the United States, <span class="num">12%</span>.</p>` },
      { camera: { center: [35.0, -90.05], zoom: 11.6 }, html: `<p>The turbines that power Colossus 2 sit just inside Mississippi, in a county that is <span class="num">33%</span> Black. But they are on the state line, and the tracts within three miles, mostly Whitehaven in Memphis, are <span class="num">65%</span> Black.</p>` },
      { image: { src: "story/img/mzx-permit-cover.jpg", caption: "The air-permit application for xAI's Southaven turbines, filed January 2026 by its company, MZX Tech LLC", credit: "Mississippi DEQ public record, via Wikimedia Commons" },
        html: `<p>Residents pushed back through the courts. In June 2025 the NAACP warned it would sue over the Memphis turbines. On <b>April 14, 2026</b> it sued xAI in federal court in Mississippi, represented by the Southern Environmental Law Center and Earthjustice, alleging the Southaven turbines ran without the permits the Clean Air Act requires.</p><p>The NAACP asked the court to stop the turbines. In June the Justice Department moved to join the case and have it dismissed. On October 19, 2026 the court denied the government's motion, and on October 30 it denied xAI's. The case goes on; nothing in those rulings decides whether xAI broke the law.</p><p class="note">ACS 2020–2024 5-year estimates (table B03002), tracts whose centers lie within 3 miles of each site. Shading: share of residents who are Black.</p>` }
    ]
  },
  {
    id: "air",
    title: "What's in the air",
    tags: ["environment", "people"],
    timeline: { from: 2024.5, to: 2026.6 },
    camera: { center: [35.07, -90.05], zoom: 10.4 },
    lens: "satellite",
    layers: { colossus: { quiet: true }, airHeat: {}, airCompare: {} },
    steps: [
      { html: `<p>Gas turbines burn methane and emit nitrogen oxides, which form smog, plus formaldehyde. xAI's own permit application put its 15 Memphis turbines at nearly <span class="num">10 tons</span> of formaldehyde a year, just under the threshold for a major source.</p>` },
      { html: `<p>For the 35 turbines that ran at Colossus 1 in early 2025, the Southern Environmental Law Center estimated <span class="num">1,200–2,000 tons</span> of NOx a year, which would make the site Memphis's largest industrial NOx source, ahead of the airport at <span class="num">1,077 tons</span>. At Southaven, the NAACP's complaint alleges the first 27 turbines could emit about <span class="num">1,700 tons</span> a year.</p><p class="note">Estimates from SELC and the plaintiffs it represents: allegations and potential-to-emit figures, not measured emissions. The heat map spreads each source's estimated tons per year with distance (turbines scaled by how many were running; nearby gas plants from EPA's 2025 data). It shows where emissions come from, not measured air quality.</p>` },
      { html: `<p>An analysis commissioned by TIME found peak nitrogen dioxide near the facility up <span class="num">79%</span> from before xAI arrived. In 2025 Memphis's ozone monitor read <span class="num">74 ppb</span>, the only one in the TVA zone above the 70 ppb standard.</p>` },
      { html: `<p>At Oak Ridge the residue went into the water and stayed for decades. Here it goes into the air, and the permits came after the turbines.</p>` }
    ]
  },
  {
    id: "hum",
    title: "The hum",
    tags: ["community", "environment"],
    timeline: { from: 2025.5, to: 2026.6 },
    camera: { center: [34.985, -90.035], zoom: 13.2 },
    lens: "satellite",
    layers: { colossus: { quiet: true }, noiseRings: {}, noiseTiles: {} },
    steps: [
      { html: `<p>Neighbors of the Southaven yard describe a constant, high-pitched roar and a vibration they feel indoors.</p>` },
      { html: `<p>A local TV crew measured <span class="num">60–65 dB</span> on Stanton Road in January 2026; residents logged the 40s to 60s inside their homes and the 70s outside. These are informal readings, not calibrated measurements. Southaven's mayor called it unacceptable; one resident said police told him there was nothing they could do.</p>` },
      { camera: { center: [35.02, -90.0], zoom: 11 }, html: `<p>The area already carried the roar of Memphis International Airport and its highways (the orange wash is the federal transportation noise map, which models road, rail and air traffic only and cannot show the turbines). In June 2026 residents filed a proposed class action against xAI over the noise; its claims are allegations.</p><p class="note">Rings are illustrative distances (½, 1, 2 km), not measured noise contours.</p>` }
    ]
  },
  {
    id: "parallels",
    title: "Parallels",
    tags: ["decisions", "community"],
    timeline: { from: 1942, to: 2026 },
    camera: { center: [35.5, -87.2], zoom: 6.6 },
    lens: "none",
    layers: { tvaZone: {}, sitePins: { show: ["oakRidge", "colossus"] }, parallelLink: {} },
    steps: [
      { html: `<table class="parallels"><thead><tr><th></th><th>Oak Ridge</th><th>Colossus</th></tr></thead><tbody>
        <tr><td>Driver</td><td>War</td><td>Market</td></tr>
        <tr><td>Speed</td><td>Plants in 2–3 yrs; S-50 in 69 days</td><td>122 days</td></tr>
        <tr><td>Power</td><td>~0.3 GW peak, ~1% of U.S.</td><td>150 MW grid + ~1.8 GW of turbines</td></tr>
        <tr><td>Bypass</td><td>Secrecy, eminent domain</td><td>"Temporary" turbines, permits after</td></tr>
        <tr><td>Race</td><td>Discrimination against Black workers: segregated, fenced hutments</td><td>Built in majority-Black neighborhoods: 92% Black within 3 mi of Colossus 1</td></tr>
        <tr><td>Air &amp; water</td><td>Mercury in the creek</td><td>NOx, formaldehyde, ozone above standard</td></tr>
        <tr><td>Sound</td><td>—</td><td>60–65 dB hum on Stanton Rd</td></tr>
        <tr><td>Recourse</td><td>Disclosed 1983; Superfund 1989</td><td>NAACP suit, noise class action</td></tr></tbody></table>` },
      { html: `<p>Oak Ridge was justified as an emergency. AI is proceeding at emergency speed without one. The question the valley already answered once: who carries the cost of haste?</p><p><a class="enter" href="explore.html">Enter the map →</a></p><p class="note">Next chapters: nuclear waste, exclusion zones, lightscape and soundscape.</p>` }
    ]
  }
];
