# ECDIS Symbology Gap Analysis — Chart No. 1 vs Pelorus Nav

Based on systematic review of U.S. Chart No. 1 (13th Edition, 2019) ECDIS column
against currently implemented layers and sprites in Pelorus Nav.

Legend: [x] = implemented, [ ] = missing, [~] = partial

S-52 references use the format: SY(symbol), LS(line), AP(pattern), CS(procedure)
S-57 object classes in CAPS, attributes in CAPS after dot (e.g., LIGHTS.CATLIT)

---

## Priority 1 — Safety-Critical Navigation Features

### P: Lights — Additional Light Features
- [x] Light point symbols SY(LIGHTS11/12/13) — red/green/white
- [x] Light flare/glow effect
- [x] Sector lights — CS(LIGHTS06): LightSectorLayer renders colored arcs from
      LIGHTS.SECTR1/SECTR2, range circles from LIGHTS.VALNMR, bearing lines
- [x] Light text labels — pipeline generates LABEL from LIGHTS.LITCHR/SIGGRP/COLOUR/SIGPER
- [x] Directional lights (P30) — rendered via sector arcs when SECTR1/2 present
- [~] **CATLIT handling in LightSectorLayer** — LIGHTS.CATLIT is in tile data.
      S-52 CS(LIGHTS06) uses CATLIT to select symbol:
      - [x] **CATLIT=1 (Directional)**: bearing line from LIGHTS.ORIENT when
        no SECTR1/SECTR2 present, rendered as dashed line (P30.1–P30.2).
        **Verify at:** Portland Head Light (43.6231°N, 70.2078°W, z13);
        Boston Light (42.3278°N, 70.8903°W, z13).
      - [ ] **CATLIT=4 (Leading)**: paired lights sharing same ORIENT get a
        connecting LS(SOLD,1,CHBLK) track line with bearing label (P20.3)
      - [ ] **CATLIT=5 (Aero)**: SY(LIGHTS11/12/13) with "Aero" prefix in
        label; could filter at lower zooms
      - [ ] **CATLIT=8 (Flood)**: SY(FLODLT01) floodlight symbol (P63)
      - [ ] **CATLIT=9 (Strip)**: SY(STRPLT01) strip light symbol (P64)
- [x] **Obscured light sectors** (P43) — LIGHTS.LITVIS=7 (obscured) or 8
      (partially obscured): dashed magenta arc instead of solid coloured arc.
      **Verify at:** Marblehead Light (42.5053°N, 70.8340°W, z14) — check for
      any obscured sectors; Cape Ann (42.66°N, 70.58°W, z13).
- [ ] **Light danger sector** (P42) — S-52 renders red danger arc
      LS(SOLD,2,LITRD) when subsidiary light marks a danger bearing

### I: Depths — Enhanced ECDIS Depth Portrayal
S-57: SOUNDG (soundings), DEPARE (depth areas), DEPCNT (contours)
S-52: CS(SOUNDG03), CS(DEPARE02), CS(DEPCNT03)
- [x] Soundings with safety depth distinction (black vs gray) — CS(SOUNDG03)
- [x] Depth contours and safety contour — CS(DEPCNT03)
- [x] Depth area shading — CS(DEPARE02): 4 zones DEPVS/DEPMS/DEPMD/DEPDW
      plus drying DEPIT, with 3 user thresholds (shallow/safety/deep)
- [~] **Drying height display** (I15) — DEPARE foreshore polygons with
      DRVAL1 < 0 already render with DEPIT colour. UWTROC WATLEV=4 (covers
      and uncovers) rocks render with existing rock symbols.
      Missing: underlined sounding display for individual negative SOUNDG
      points (S-52 underline convention). No negative SOUNDG points exist
      in current NOAA ENC data (drying heights are in DEPARE/UWTROC instead).
      Also missing: SY(DRGARE01) annotation on drying area polygons.
- [ ] **Low-accuracy sounding** (I1–I4) — S-52: SY(QUAPOS01) dotted circle
      around sounding. S-57: SOUNDG.QUAPOS (quality of position) values
      3–9 indicate approximate/doubtful position. No QUAPOS 3-9 found in
      current NOAA ENC data.
- [ ] **Swept area symbol** (I24) — S-52: LS(DASH,2,DEPSC) boundary with
      SY(SWPARE01) swept depth label. S-57: SWPARE (swept area) object,
      attributes DRVAL1 (swept depth), TECSOU, QUAPOS.

### K: Rocks, Wrecks, Obstructions — Foul Areas & Aquaculture
S-57: OBSTRN, WRECKS, UWTROC, FLODOC (foul area)
S-52: CS(OBSTRN07), CS(WRECKS05), CS(UWTROC05)
- [x] Wrecks — CS(WRECKS05): SY(WRECKS01/04/05) based on WRECKS.CATWRK/WATLEV/VALSOU
- [x] Obstructions — CS(OBSTRN07): SY(OBSTRN01/02/03/11) based on OBSTRN.CATOBS/VALSOU
- [x] Underwater rocks — CS(UWTROC05): SY(UWTROC03/04) based on UWTROC.WATLEV/VALSOU
- [x] Isolated danger overlay — CS(UDWHAZ05): SY(ISODGR01) magenta diamond
- [x] **Foul area pattern** (K1, K31) — AP(FOULAR01) X-pattern fill +
      dashed boundary for OBSTRN.CATOBS=6/7 polygon areas.
      **Verify at:** Boston Harbor islands (42.32°N, 70.92°W, z14) —
      many CATOBS=6 foul area polygons along rocky shore;
      Hull/Hingham Bay (42.33°N, 70.97°W, z14).
- [ ] **Coral reef** (K16) — S-52: AP(DIAMOND1) cross-hatch pattern for
      always-covered reef. S-57: OBSTRN with CATOBS=9 (reef) or separate
      object. SY(OBSTRN01) + depth symbology for point features.
- [ ] **Fish stakes** (K44.1) — S-52: SY(FSHSTK01) point, AP(FSHSTK01) area.
      S-57: OBSTRN with CATOBS=1 (fishing stakes).
- [ ] **Fish trap/weir** (K44.2, K45) — S-52: SY(FSHTMP01) point,
      AP(FSHTMP01) area. S-57: OBSTRN with CATOBS=2 (fish trap).
- [ ] **Marine farm** (K48) — S-52: SY(MRFARM01) point, AP(MRFARM01) area
      with fish pattern. S-57: MARCUL (marine farm/culture) object,
      attributes CATMFA (type), EXPSOU, RESTRN.
- [ ] **Shellfish beds** (K47) — S-52: SY(MRFARM01).
      S-57: MARCUL with CATMFA (shellfish).
- [ ] **Kelp/weed** (J13) — S-52: SY(WEDKLP01) point, AP(WEDKLP01) area.
      S-57: WEDKLP (weed/kelp) object.

### M: Tracks, Routes — Routing Measures
S-57: TSSLPT, TSSRON, TSSBND, TSEZNE, ISTZNE, RCTLPT, DWRTPT, DWRTCL
S-52: CS(RESTRN01) for restricted routing areas
- [x] TSS lanes — TSSLPT with LS(SOLD,3,TRFCD) boundary
- [x] TSS boundaries — TSSBND with LS(DASH,2,TRFCD)
- [x] Separation zones — TSEZNE fill
- [x] Precautionary areas — PRCARE with LS(DASH,2,TRFCD)
- [x] Recommended tracks — RECTRC with LS(DASH,2,TRFCD)
- [x] Navigation lines — NAVLNE with LS(DASH,1,CHGRD)
- [x] Deep water route centerline — DWRTCL
- [x] Fairways — FAIRWY with LS(DASH,2,CHGRD)
- [x] Two-way routes — TWRTPT
- [x] **Traffic direction arrows** (M10–M11) — SY(TSSLPT51) arrow at lane
      centroid, rotated by ORIENT. Filtered to directed lanes (TRAFIC 1–3).
      **Verify at:** Boston TSS (42.3283°N, 70.7867°W, z11) — inbound/outbound
      lanes in Boston harbor approach; Narragansett Bay TSS (41.38°N, 71.38°W, z11).
- [ ] **Inshore traffic zone** (M25) — S-52: SY(ITZARE01) "IT" text symbol.
      S-57: ISTZNE (inshore traffic zone) object.
- [ ] **Area to be avoided** (M29) — S-52: AP(TSSJCT02) T-hatched pattern,
      LS(DASH,2,TRFCD) boundary. S-57: RESARE with CATREA=14 (ATBA) or
      RESTRN=13 (area to be avoided).
- [ ] **TSS roundabout** (M21) — S-52: SY(TSSRON01) circular arrows.
      S-57: TSSRON (TSS roundabout) object.
- [ ] **Archipelagic sea lane** (M17) — S-52: LS(DASH,2,TRFCD) axis +
      LS(SOLD,2,TRFCD) boundary. S-57: ARCSLN object.
- [ ] **Ferry routes** (M50–M51) — S-52: LS(DASH,1,CHGRD) + SY(FRYARE01)
      box symbol. S-57: FERYRT (ferry route) object.
- [ ] **Deep water route "DW" labels** (M5, M27) — S-52: TE("DW") text in
      route. S-57: DWRTPT.TRAFIC + DRVAL1 for depth.
- [ ] **Radio calling-in points** (M40) — S-52: SY(RDOCAL02) triangle with
      designation text. S-57: RDOCAL object, attrs ORIENT, COMCHA (VHF channel),
      TRAFIC (direction).

---

## Priority 2 — Important Navigation Features

### N: Areas, Limits — Restricted/Regulated Areas
S-57: RESARE, ACHARE, CTNARE, MIPARE, DMPGRD, ADMARE, EXEZNE, ICNARE
S-52: CS(RESARE04), CS(RESTRN01)
- [x] Restricted areas — CS(RESARE04): RESARE with SY(ENTRES51/61/71)
      based on RESARE.RESTRN attribute
- [x] Caution areas — CTNARE with SY(CTNARE51)
- [x] Anchorage areas — ACHARE with SY(ACHARE02), LS(DASH,2,CHMGF)
- [x] Dumping grounds — DMPGRD with LS(DASH,2,CHMGD)
- [ ] **Anchoring prohibited** (N20) — S-52: AP(NODATA03)-like anchor+X pattern,
      SY(ACHRES51) with RESTRN=1. S-57: RESARE.RESTRN=7 (anchoring prohibited)
      or =14 (anchoring restricted). Currently we show ACHRES51 symbol but not
      the distinct area fill pattern with crossed anchors.
- [ ] **Fishing prohibited** (N21) — S-52: AP with crossed fish pattern,
      SY(FSHRES51). S-57: RESARE.RESTRN=2 (fishing prohibited) or =6
      (fishing restricted).
- [ ] **Mining/extraction area** (N63) — S-52: SY(DREDGE01) dredging symbol.
      S-57: EXEZNE or RESARE with appropriate CATREA.
- [ ] **Military practice areas** (N30–N34) — S-52: SY(ENTRES61) restricted
      entry. S-57: MIPARE (military practice area), RESARE with
      CATREA=1 (offshore safety zone) or =9 (firing practice area).
      RESARE.RESTRN=7 for entry prohibited.
- [ ] **ESSA** (N22) — S-52: TE("ESSA") text label, boundary with
      LS(DASH,1,TRFCD). S-57: RESARE with CATREA=22 (ESSA) or =24 (PSSA).
- [ ] **PSSA** (N22) — S-52: TE("PSSA") text label. S-57: RESARE.CATREA=24.
- [ ] **International boundaries** (N40–N41) — S-52: LS with T-pattern
      SY(BNDRY01). S-57: ADMARE (administration area), MIPARE, or M_NSYS.
- [ ] **Territorial sea limit** (N43) — S-52: LS(DASH,2,CHGRD).
      S-57: TESARE (territorial sea area) boundary.
- [ ] **EEZ limit** (N47) — S-52: LS(DASH,2,CHGRD).
      S-57: EXEZNE (exclusive economic zone) boundary.
- [ ] **Spoil ground** (N62) — S-52: SY(INFARE51) info note.
      S-57: SPLARE (spoil area) or DMPGRD with CATDMP.
- [ ] **Degaussing area** (N25) — S-52: SY(ENTRES51) restricted.
      S-57: DGRARE (degaussing range) or RESARE with CATREA.

### L: Offshore Installations
S-57: OFSPLF, OBSTRN, OSPARE, BOYINB, MORFAC
S-52: CS(OWNSHP01) for safety zones
- [x] Offshore platforms — OFSPLF with SY(OFSPLF01)
- [x] Submarine cables — CBLSUB with LS(DASH,3,CHMGD), CBLARE
- [x] Pipelines — PIPSOL with LS(DASH,3,CHMGD), PIPARE
- [ ] **Safety zone** (L3) — S-52: SY(ENTRES61) entry prohibited +
      LS(DASH,2,TRFCD) boundary. S-57: RESARE.CATREA=1 (offshore safety zone)
      around OFSPLF. 500m radius typically.
- [ ] **Wind farm (offshore)** (L5.2) — S-52: SY(ENTRES61) caution +
      SY(WNDFRM61) wind turbine. S-57: OSPARE (offshore production area)
      with CATPRA=5 (wind farm). Boundary LS(DASH,2,CHMGD).
- [ ] **Wave farm** (L6) — S-52: SY(ENTRES61) caution.
      S-57: OSPARE with CATPRA=6 (wave energy device).
- [ ] **Installation buoy** (L12, L16) — S-52: SY(BOYSPP11) simplified,
      SY(BOYINB01) paper chart. S-57: BOYINB (installation buoy) or
      BOYSPP with CATSPM=9 (ODAS buoy).
- [ ] **Underwater turbine** (L24) — S-52: SY(INFORM01) info symbol.
      S-57: OBSTRN with CATOBS=10 (underwater turbine).
- [ ] **ODAS** (L25) — S-52: SY(INFORM01) info symbol.
      S-57: OBSTRN with CATOBS=8 (ODAS).
- [ ] **Pipeline tunnel** (L42.2) — S-52: LS(DASH,2,CHMGD) distinct pattern.
      S-57: TUNNEL or PIPSOL with specific attributes.
- [ ] **Diffuser/crib** (L43) — S-52: hazard symbols at pipeline terminus.
      S-57: OBSTRN.CATOBS at end of PIPSOL.
- [ ] **Disused pipeline** (L44) — S-52: LS(DASH,1,CHGRD) lighter pattern.
      S-57: PIPSOL.STATUS=4 (not in use) or =5 (periodic).

### H: Tides, Currents
S-57: TS_TRF (tidal stream - flood/ebb), TS_PAD (tidal stream panel data),
      CURENT (current), OVFALL (overfalls), T_TIMS (tidal info)
S-52: CS(CURRNT01) for current arrows
- [ ] **Tidal stream arrows** (H40–H42) — S-52: SY(TIDSTR01) flood arrow,
      SY(TIDSTR02) ebb arrow, with TE for rate (kn). S-57: TS_TRF
      (tidal stream flood/ebb), attrs ORIENT (direction), CURVEL (rate).
- [ ] **Current arrows** (H42–H43) — S-52: SY(CURENT01) arrow +
      TE("%.1f kn",CURVEL). S-57: CURENT object, attrs ORIENT, CURVEL.
- [ ] **Overfalls/tide rips** (H44) — S-52: SY(OVFALL01) point,
      LS(SOLD,2,CHGRD) line, AP(OVERFL01) area. S-57: OVFALL object.
- [ ] **Tidal diamond** (H46) — S-52: SY(TIDSTR03) diamond with letter.
      S-57: TS_PAD (tidal stream panel data), linked to T_TIDS table.
- [ ] **Tidal info area** (H40) — S-52: LS(DASH,1,CHGRD) boundary.
      S-57: T_TIMS (tidal information) area boundary.

### E: Landmarks — Additional Types
S-57: LNDMRK (landmark), attrs: CATLMK, CONVIS, FUNCTN
S-52: CS(LNDMRK04) — switches symbol based on CATLMK + CONVIS
- [x] Towers — SY(TOWERS01) conspic / SY(TOWERS02) non-conspic. CATLMK=17/20
- [x] Chimneys — SY(CHIMNY01) conspic / SY(CHIMNY11) non-conspic. CATLMK=3
- [x] Windmills — SY(WNDMIL02) conspic / SY(WNDMIL12) non-conspic. CATLMK=19
- [x] Monuments — SY(MONUMT02) conspic / SY(MONUMT12) non-conspic. CATLMK=7
- [x] Flagstaffs — SY(FLGSTF01) conspic / SY(FLGSTF02) non-conspic. CATLMK=5
- [x] **Dome** — SY(DOMES001) conspic / SY(DOMES011) non-conspic. CATLMK=15.
      **Verify at:** Boston (42°21.54'N, 71°01.64'W, z14) — dome with church function.
- [x] **Dish aerial** — SY(DSHAER01) conspic / SY(DSHAER11) non-conspic. CATLMK=4.
      No CATLMK=4 features found in current tile coverage.
- [x] **Flare stack** (E23) — SY(FLRSTK01) conspic / SY(FLRSTK11) non-conspic. CATLMK=6.
      No CATLMK=6 features found in current tile coverage.
- [ ] **Mosque/minaret** (E17) — S-52: SY(MOSQUE01). Not a CATLMK value;
      encoded via FUNCTN or CATLMK=20 (spire/minaret). Spire mapped to church icon.
- [ ] **Church** (E10) — S-52: SY(CHURCH01). Encoded as FUNCTN=20 (church),
      not a CATLMK value. Needs FUNCTN-based matching (not yet implemented).
- [ ] **Religious building non-Christian** (E13) — S-52: SY(TMBYRD01) conspic /
      SY(TMBYRD11) non-conspic. FUNCTN=22 (temple). Needs FUNCTN-based matching.
- [x] **Radar scanner** (E30.3) — SY(RASCAN01) conspic / SY(RASCAN11) non-conspic. CATLMK=16.
      No CATLMK=16 features found in current tile coverage.
- [x] **Cairn** (Q100) — SY(CAIRNS01) conspic / SY(CAIRNS11) non-conspic. CATLMK=1.
      **Verify at:** Boston (42°21.49'N, 71°03.82'W, z14);
      Marblehead (42.47°N, 70.91°W, z14).
- [ ] **Tank farm** (E32) — S-52: SY(TNKFRM01) area / SY(TNKFRM11) non-conspic.
      S-57: LNDMRK.CATLMK=16 (tank farm) or BUISGL with FUNCTN.
- [ ] **Quarry** (E35) — S-52: SY(QUARRY01) area, SY(QUARRY11) point.
      S-57: LNDMRK.CATLMK=10 (quarry). Also: CBLOHD area variant.
- [ ] **Wind generator farm** (E26.2) — S-52: SY(WNDFRM61) area symbol.
      S-57: LNDMRK.CATLMK=21 (wind generator farm) or OSPARE.CATPRA=5.

### F: Ports — Harbor Structures
S-57: BRIDGE, SLCONS, GATCON, FLODOC, HULKES, CAUSWY, MORFAC
- [x] Bridges — BRIDGE with SY(BRIDGE01), LS(SOLD,4,LANDF)
- [x] Dry docks — DRYDOC fill
- [x] Hulks — HULKES fill + outline
- [x] Pontoons — PONTON fill
- [ ] **Opening bridge** (D23) — S-52: SY(BRIDGE01) + SY(BRGSOP01) open circle.
      S-57: BRIDGE.CATBRG=2 (opening) or =3 (swing) or =4 (lifting) or
      =5 (bascule) or =9 (draw). BRIDGE.VERCLR (closed clearance),
      BRIDGE.VERCCL (clearance closed), BRIDGE.VERCOP (clearance open).
- [ ] **Seawall** (F2) — S-52: LS(SOLD,4,LANDF) thick line.
      S-57: SLCONS with CATSLC=1 (breakwater) or =3 (seawall).
- [ ] **Breakwater** (F4) — S-52: LS(SOLD,4,LANDF) line, fill for area.
      S-57: SLCONS.CATSLC=1 (breakwater). WATLEV determines if covers.
- [ ] **Lock gate** (F41) — S-52: SY(GATCON01) navigable, SY(GATCON02)
      non-navigable. S-57: GATCON with CATGAT=1 (flood barrage gate),
      =2 (caisson), =3 (lock gate), =4 (dyke gate).
- [ ] **Floating dock** (F26) — S-52: LS(SOLD,2,LANDF) line,
      fill for area. S-57: FLODOC (floating dock) object.
- [ ] **Groin** (F6) — S-52: LS(SOLD,2,LANDF).
      S-57: SLCONS.CATSLC=4 (groin/groyne).
- [ ] **Slipway/ramp** (F23) — S-52: LS(DASH,2,LANDF).
      S-57: SLCONS.CATSLC=7 (slipway/ramp).
- [ ] **Floating barrier/boom** (F29) — S-52: SY(FLTHAZ01) floating hazard +
      LS(DASH,2,CHMGD). S-57: OBSTRN.CATOBS=5 (boom/floating barrier).
- [ ] **RoRo terminal** (F50) — S-52: TE("RoRo") text label.
      S-57: HRBFAC.CATHAF=5 (RoRo terminal) or SMCFAC attribute.
- [ ] **Landing/steps** (F17–F18) — S-52: LS(SOLD,2,LANDF).
      S-57: SLCONS.CATSLC=8 (landing steps) or =13 (landing for boats).

---

## Priority 3 — Supplementary & Informational

### C: Natural Features
S-57: LNDRGN (land region), COALNE, SLCONS
S-52: CS(LNDARE04) for land features
- [x] Coastline — COALNE, LS(SOLD,2,CSTLN)
- [x] Rivers, lakes — RIVERS, LAKARE fills
- [x] Marsh/swamp pattern — AP(MARSHES1). S-57: LNDRGN.CATLND=2 (marsh) or =12 (swamp)
- [ ] **Cliff** (C3) — S-52: SY(CLIFFW01) point, LS(SOLD,2,LANDF) crest line.
      S-57: SLOGRD (sloping ground) or LNDRGN.CATLND=1 (cliff).
- [ ] **Wooded area** (C30) — S-52: AP(FRTREE01) tree pattern.
      S-57: LNDRGN.CATLND=5 (wooded) or VEGATN.CATVEG.
- [ ] **Mangrove** (C32) — S-52: SY(MGROVE01) point, LS(SOLD,1,CHGRD)
      low-accuracy coastline. S-57: LNDRGN.CATLND=6 (mangrove).
- [ ] **Glacier/ice area** (C25) — S-52: AP(ICEARE01) pattern.
      S-57: ICEARE (ice area) or LNDRGN.CATLND=4 (glacier).
- [ ] **Sand dunes** (C8) — S-52: SY(HILARE01) conspicuous hill symbol.
      S-57: LNDRGN.CATLND=3 (dune).

### D: Cultural Features
S-57: BUISGL, ROADWY, RAILWY, AIRARE, TUNNEL, CBLOHD, PIPOHD
- [x] Buildings — BUISGL fill + outline
- [x] Roads — ROADWY LS(SOLD,2,LANDF)
- [x] Railways — RAILWY LS
- [x] Airports/runways — AIRARE fill + outline
- [x] Tunnels — TUNNEL LS(DASH,2,CHGRD)
- [ ] **Overhead cable with clearance** (D26–D27) — S-52: LS(DASH,1,CHBLK) +
      TE("clr %.1f",VERCLR) or TE("sf clr %.1f",VERCSA).
      S-57: CBLOHD.VERCLR (vertical clearance), VERCSA (safe clearance).
      We render CBLOHD line but not the clearance label.
- [ ] **Overhead pipeline** (D28) — S-52: same pattern as cable.
      S-57: PIPOHD (pipeline overhead), VERCLR/VERCSA attrs.
- [ ] **Embankment** (D15) — S-52: LS(SOLD,2,CHGRD), wider if conspicuous.
      S-57: SLCONS.CATSLC=6 (embankment).
- [ ] **Cutting** (D14) — S-52: LS(SOLD,2,CHGRD).
      S-57: SLCONS.CATSLC=5 (cutting).

### J: Nature of the Seabed
S-57: SBDARE, WEDKLP, SNDWAV, SPRING
S-52: CS(SBDARE02) for seabed display
- [x] Seabed type abbreviations — SBDARE via cursor pick, NATSUR attr
- [ ] **Sandwaves** (J14) — S-52: SY(SNDWAV01) point, LS(SOLD,1,CHGRD) line,
      AP(SNDWAV01) area. S-57: SNDWAV (sand waves) object.
- [ ] **Spring in seabed** (J15) — S-52: SY(SPRING01).
      S-57: SPRING object at seabed location.
- [ ] **Rocky ledges/coral reef area** (J21–J22) — S-52: SY(UWTROC04) +
      AP(RCKLDG01). S-57: SBDARE with NATSUR=9 (rock) as area, or
      OBSTRN.CATOBS=9 (reef).

### Q: Buoys, Beacons — Additional Types
S-57: BOYSPP, LITVES, LITFLT, MORFAC, DAYMAR, BCNLAT
S-52: CS(BOYLAT04), CS(BOYCAR04), CS(BCNLAT04)
- [x] Lateral buoys — SY(BOYLAT13/14/23/24). BOYLAT.CATLAM + BOYSHP + COLOUR
- [x] Cardinal buoys — SY(BOYCAR01-04). BOYCAR.CATCAM (N/S/E/W)
- [x] Safe water buoys — SY(BOYSAW12). BOYSAW
- [x] Special purpose buoys — SY(BOYSPP11/15/25/35). BOYSPP.CATSPM + BOYSHP
- [x] Isolated danger buoys — SY(BOYISD12). BOYISD
- [x] Beacons — SY(BCNLAT15/16/21/22), SY(BCNCAR01-04), SY(BCNSPP13/21)
- [x] Topmarks — SY(TOPMAR02-65). TOPMAR.TOPSHP attribute
- [x] Daymarks — SY(PRICKE03/04). DAYMAR.TOPSHP + COLOUR
- [ ] **Spar buoy** (Q24) — S-52: SY(BOYSPR01) spar-specific symbol.
      S-57: BOYLAT/BOYSPP with BOYSHP=5 (spar). Currently falls through
      to pillar symbol — needs distinct spar shape.
- [ ] **Barrel/tun buoy** (Q25) — S-52: SY(BOYBAR01).
      S-57: BOYLAT/BOYSPP with BOYSHP=6 (barrel/tun).
- [x] Superbuoy/LANBY (Q26) — SY(BOYSUP02) with ODAS/LANBY detection
- [ ] **Light float** (Q30) — S-52: SY(LITFLT01) ship-shaped.
      S-57: LITFLT (light float) object class. Distinct from buoys.
- [ ] **Light vessel** (Q32) — S-52: SY(LITVES01) ship-shaped.
      S-57: LITVES (light vessel) object class.
- [ ] **Mooring buoys** (Q40–Q44) — S-52: SY(MORFAC03/04) + various shapes.
      S-57: MORFAC with CATMOR=1–7 (dolphin, bollard, pile, chain, buoy, etc.).
      We render MORFAC03/04 but not all mooring area patterns.
- [ ] **Notice board** (Q126) — S-52: SY(NOTBRD01).
      S-57: NOTMRK (notice mark) with CATNMK attribute.
- [ ] **Leading beacons** (Q120) — S-52: paired beacons with LS(SOLD,1,CHBLK)
      bearing line + TE("%.0f deg",ORIENT).
      S-57: BCNLAT/BCNCAR with CATLIT=4 (leading) on associated LIGHTS.

### R: Fog Signals
S-57: FOGSIG, attrs: CATFOG, SIGGRP, SIGPER, VALMXR
S-52: CS(FOGSIG02)
- [x] Fog signal symbol — SY(FOGSIG01)
- [ ] **Fog signal type label** — S-52: TE with CATFOG abbreviation
      (Horn, Bell, Whistle, Siren, etc.) next to symbol.
      S-57: FOGSIG.CATFOG (1=explosive, 2=diaphone, 3=siren, 4=nautophone,
      5=reed, 6=tyfon, 7=bell, 8=whistle, 9=gong, 10=horn).

### S: Radar, Radio, Satellite
S-57: RADRFL, RTPBCN, RDOSTA, RADSTA, CRANES, SISTAT
S-52: SY(RADRFL01), SY(RTPBCN01), SY(RDOSTA01)
- [ ] **RACON** (S3) — S-52: SY(RTPBCN01) circle symbol + TE for morse ID.
      S-57: RTPBCN (radar transponder beacon) with CATRTB=1 (RACON),
      attrs SIGGRP (morse letter), VALMXR (range).
- [ ] **AIS transmitter** (S17) — S-52: SY(SISTAW01) on associated aid.
      S-57: SISTAT (signal station) with CATSIT attrs, or associated with
      BOYLAT/BCNLAT via relationship.
- [ ] **Virtual AIS aids** (S18) — S-52: SY(VARONE01-07) for cardinal/lateral/
      special purpose/etc. S-57: NEWOBJ (new object) with CATVAI attrs for
      V-AIS type (lateral, cardinal, isolated danger, safe water, special purpose).
- [ ] **Radio station** (S10) — S-52: SY(RDOSTA01) circle.
      S-57: RDOSTA (radio station), attrs CATROS (type).
- [ ] **DGPS station** (S51) — S-52: SY(RDOSTA01) + TE("DGPS").
      S-57: RDOSTA with CATROS=7 (DGPS).

### T: Services
S-57: PILBOP, CGUSTA, SISTAT, RSCSTA
S-52: SY(PILBOP01), SY(CGUSTA01), SY(SISTAT01), SY(RSCSTA01)
- [x] Coast Guard stations — SY(CGUSTA01). S-57: CGUSTA
- [ ] **Pilot boarding place** (T1) — S-52: SY(PILBOP01) symbol +
      SY(PLNPOS02) for helicopter transfer. S-57: PILBOP.CATPIL
      (1=boarding by pilot vessel, 2=helicopter). We have PILBOP layers
      but may not distinguish helicopter variant.
- [ ] **Signal station** (T20–T36) — S-52: SY(SISTAT01) "SS" box.
      S-57: SISTAT with CATSIT (1=port control, 2=IPT, 6=traffic,
      8=bridge, 13=lock, 22=tide, etc.).
- [ ] **Rescue station** (T12–T13) — S-52: SY(RSCSTA01) cross symbol.
      S-57: RSCSTA (rescue station) with CATRSC.
- [ ] **Customs** (F61) — S-52: SY(CSTOMS01) circle-minus.
      S-57: BUISGL.FUNCTN=3 (customs office).

### U: Small Craft Facilities
S-57: SMCFAC, attrs: CATSCF
S-52: SY(SMCFAC01) + cursor pick for details
- [ ] **Small craft facility symbols** — S-52: SY(SMCFAC01) with cursor-pick
      details. S-57: SMCFAC.CATSCF (1=visitors berth, 3=restaurant,
      5=chandler, 8=slipway, 10=fuel, 12=toilets, etc.). Currently we
      render SMCFAC labels but not individual facility symbols.

---

## Conspicuous/Non-Conspicuous Feature System (p.28)

S-52 CS(LNDMRK04): checks LNDMRK.CONVIS (conspicuousness).
CONVIS=1 → black conspicuous symbol (11 suffix, sCHBLK), CONVIS absent/other → brown
non-conspicuous (01 suffix, sLANDF). **TODO:** CONVIS switching is not yet implemented
in the icon expression — all landmarks currently show the non-conspicuous (brown, 01)
variant regardless of CONVIS. Needs a nested expression: match CATLMK first, then
branch on CONVIS=1 for conspic vs non-conspic sprite within each type.
25 feature types. Currently we render some but not all:

- [x] Chimney — SY(CHIMNY01/11). CATLMK=3
- [x] Tower — SY(TOWERS01/02). CATLMK=17/20
- [x] Water tower — SY(TOWERS03/05). CATLMK=18
- [x] Windmill — SY(WNDMIL02/12). CATLMK=19
- [x] Monument — SY(MONUMT02/12). CATLMK=7
- [x] Flagstaff — SY(FLGSTF01/02). CATLMK=5
- [x] Silo — SY(SILBUI01/11). CATLMK=13 (SILTNK object, CATSIL=1)
- [x] Tank — SY(SILBUI01/11). CATSIL=2
- [x] Single building — SY(BUISGL01/11). BUISGL object
- [x] Cranes — SY(CRANES01). CRANES object via POSGEN04
- [x] **Cairn** — SY(CAIRNS01/11). CATLMK=15
- [x] **Dish aerial** — SY(DSHAER01/11). CATLMK=1
- [x] **Dome** — SY(DOMES001/011). CATLMK=4
- [x] **Flare stack** — SY(FLRSTK01/11). CATLMK=6
- [ ] **Fortified structure** — SY(FORSTC01/11). FORSTC object. Have area but
      not conspicuous point symbol.
- [ ] **Hill/mountain top** — SY(HILARE01/11). LNDRGN.CATLND via CONVIS
- [ ] **Mast** — SY(TOWERS01/02) variant. CATLMK=9 (mast)
- [x] **Mosque/minaret** — SY(MOSQUE01/11). CATLMK=8
- [x] **Radar scanner** — SY(RASCAN01/11). CATLMK=12
- [ ] **Radio/TV tower** — SY(TOWERS01/02). CATLMK=20 (radio/TV tower).
      May already work via towers — needs verification.
- [ ] **Refinery** — SY(RFNERY01/11). CATLMK=11 or BUISGL.FUNCTN
- [x] **Religious building (Christian)** — SY(CHURCH01/11). CATLMK=2
- [ ] **Religious building (non-Christian)** — SY(TMBYRD01/11). FUNCTN=2
- [ ] **Tank farm** — SY(TNKFRM01/11). CATLMK=16 or area
- [ ] **Wind motor** — SY(WNDMOT01/11). CATLMK=19+no sails or CATLMK=21
- [ ] **Wind generator farm** — SY(WNDFRM01/11). CATLMK=21
- [ ] **Mangrove** — SY(MGROVE01) brown only. CATLMK=6 variant
- [ ] **Mine/quarry** — SY(QUARRY01) brown only. CATLMK=10
- [ ] **Timber yard** — SY(TIMBYD01) brown only. S-57: area feature
- [ ] **Tree** — SY(TREEXX01) brown only. Isolated tree landmark

---

## Summary — Rough Count of Missing ECDIS Features

| Priority | Category | Missing Items |
|----------|----------|--------------|
| P1 | Directional/leading/obscured lights | ~3 (was ~5) |
| P1 | Enhanced depth display | ~3 |
| P1 | Foul areas & aquaculture | ~6 (was ~7) |
| P1 | Routing measure details | ~7 (was ~8) |
| P2 | Restricted/regulated areas | ~12 |
| P2 | Offshore installations | ~8 |
| P2 | Tides & currents | ~5 |
| P2 | Additional landmarks | ~5 (was ~12) |
| P2 | Harbor structures | ~12 |
| P3 | Natural features | ~5 |
| P3 | Cultural features | ~4 |
| P3 | Seabed features | ~3 |
| P3 | Additional buoy/beacon types | ~8 |
| P3 | Fog/radar/radio/services | ~10 |
| — | Conspicuous/non-conspicuous | ~11 (was ~17) |
| | **Total** | **~102** (was ~120) |

## Recommended Implementation Order

1. ~~**Traffic direction arrows in TSS**~~ ✅ — SY(TSSLPT51) in TSSLPT, rotated by ORIENT
2. ~~**CATLIT=1 directional light bearings**~~ ✅ — bearing line from ORIENT in LightSectorLayer
3. ~~**LITVIS handling**~~ ✅ — obscured sector arcs rendered as dashed magenta
4. ~~**Foul area patterns**~~ ✅ — AP(FOULAR01) for OBSTRN.CATOBS=6/7
5. **Anchoring/fishing prohibited areas** — RESARE.RESTRN=7 pattern fills
6. **Tidal current arrows** — SY(TIDSTR01/02), SY(CURENT01) for TS_TRF/CURENT
7. ~~**Additional landmark CATLMK types**~~ ✅ — 7 new types: dome, dish aerial,
   flare stack, mosque, church, radar scanner, cairn
8. **Opening bridges** — BRIDGE.CATBRG for swing/bascule/draw + clearance labels
9. **Marine farm/aquaculture** — MARCUL object, SY(MRFARM01)/AP(MRFARM01)
10. **Remaining restricted area subtypes** — expand RESARE.RESTRN/CATREA handling

Test results:
1: I see the separation lanes but not the arrows. UPDATE: DONE
2: I think it's OK; I see two dashed lines maybe 5-10° apart, then two solid lines making a 1° angle (or so), with red/yellow/green sector markings, but not a single bearing line.
3: At Marblehead Light I do not see any sector markings at all at any zoom. Just the tower, light glow, and "F G" label

