# Detail levels — layer visibility matrix

**Generated file — do not edit.** Regenerate with `bun tools/detail-levels-report.ts`.

Each cell is the zoom a style layer becomes visible at that Detail-slider
position (`all` = every zoom, `—` = not built). Extracted from
`getNauticalLayers()` so it always matches the shipped style.

Cross-cutting behavior not visible in the table:

- `\*` marks a layer with a feature filter. Three are detail-dependent:
  at Standard and Base, `s57-soundg` hides soundings deeper than the
  user's deep threshold until z13, and `s57-lights`/`s57-lights-glow`
  hide lights with range < 10 nm until z10.
- Hazard icons (UWTROC/OBSTRN/WRECKS) claim collision space below z13 at
  every detail level, so dense clusters self-thin; at z13+ all draw.
- Layer-group toggles (Settings › Charts & Layers) flip `visibility` on
  top of this matrix — a toggle can only hide layers this table says exist.

| Source layer | Style layer | Base | Standard | Standard+ | Full |
|---|---|---|---|---|---|
| ACHARE | `s57-achare` | — | all | all | all |
| ACHARE | `s57-achare-symbol` | — | z10+ | z10+ | z9+ |
| ACHBRT | `s57-achbrt` | — | z11+ | z11+ | z10+ |
| AIRARE | `s57-airare` | — | z13+ | z13+ | z12+ |
| AIRARE | `s57-airare-outline` | — | z13+ | z13+ | z12+ |
| BCNCAR | `s57-bcncar` | — | z10+ | z8+ | z8+ |
| BCNISD | `s57-bcnisd` | — | z8+ | z8+ | z8+ |
| BCNLAT | `s57-bcnlat` | — | z10+ | z8+ | z8+ |
| BCNSAW | `s57-bcnsaw` | — | z10+ | z8+ | z8+ |
| BCNSPP | `s57-bcnspp` | — | z8+ | z8+ | z8+ |
| BERTHS | `s57-berths-label` | — | — | z13+ \* | z12+ \* |
| BOYCAR | `s57-boycar` | — | z10+ | z8+ | z8+ |
| BOYISD | `s57-boyisd` | — | z6+ | z6+ | z6+ |
| BOYLAT | `s57-boylat` | — | z10+ | z8+ | z8+ |
| BOYSAW | `s57-boysaw` | — | z10+ | z8+ | z8+ |
| BOYSPP | `s57-boyspp` | — | z10+ | z8+ | z8+ |
| BRIDGE | `s57-bridge` | — | all | all | all |
| BRIDGE | `s57-bridge-label` | — | z13+ \* | z13+ \* | z12+ \* |
| BRIDGE | `s57-bridge-label-line` | — | z13+ \* | z13+ \* | z12+ \* |
| BRIDGE | `s57-bridge-opening` | — | z12+ \* | z12+ \* | z11+ \* |
| BUAARE | `s57-buaare-label` | z9+ \* | z9+ \* | z9+ \* | z8+ \* |
| BUISGL | `s57-buisgl` | — | all | all | all |
| BUISGL | `s57-buisgl-functn` | — | — | z13+ \* | z12+ \* |
| BUISGL | `s57-buisgl-label` | — | — | z14+ \* | z13+ \* |
| BUISGL | `s57-buisgl-outline` | — | all | all | all |
| CANALS | `s57-canals` | all | all | all | all |
| CBLARE | `s57-cblare` | — | z12+ | z12+ | z11+ |
| CBLOHD | `s57-cblohd` | — | all | all | all |
| CBLOHD | `s57-cblohd-label` | — | z14+ \* | z14+ \* | z13+ \* |
| CBLSUB | `s57-cblsub` | — | all | all | all |
| CGUSTA | `s57-cgusta` | — | z12+ | z12+ | z11+ |
| COALNE | `s57-coalne` | all | all | all | all |
| CRANES | `s57-cranes` | — | z13+ | z13+ | z12+ |
| CTNARE | `s57-ctnare` | — | all | all | all |
| CTNARE | `s57-ctnare-symbol` | — | z8+ | z8+ | z8+ |
| CURENT | `s57-curent` | — | z10+ | z10+ | z10+ |
| DAMCON | `s57-damcon` | — | all | all | all |
| DAYMAR | `s57-daymar` | — | z8+ | z8+ | z8+ |
| DEPARE | `s57-depare-deep` | all \* | all \* | all \* | all \* |
| DEPARE | `s57-depare-drying` | all \* | all \* | all \* | all \* |
| DEPARE | `s57-depare-medium` | all \* | all \* | all \* | all \* |
| DEPARE | `s57-depare-shallow` | all \* | all \* | all \* | all \* |
| DEPCNT | `s57-depcnt` | all | all | all | all |
| DEPCNT | `s57-depcnt-label` | — | all | all | all |
| DEPCNT | `s57-depcnt-safety` | all \* | all \* | all \* | all \* |
| DMPGRD | `s57-dmpgrd` | — | z12+ | z12+ | z11+ |
| DMPGRD | `s57-dmpgrd-outline` | — | z12+ | z12+ | z11+ |
| DRGARE | `s57-drgare` | — | all | all | all |
| DRGARE | `s57-drgare-outline` | — | all | all | all |
| DRYDOC | `s57-drydoc` | — | z13+ | z13+ | z12+ |
| DRYDOC | `s57-drydoc-outline` | — | z13+ | z13+ | z12+ |
| DWRTCL | `s57-dwrtcl` | — | all | all | all |
| DWRTCL | `s57-dwrtcl-label` | — | z10+ | z10+ | z10+ |
| DYKCON | `s57-dykcon` | — | all | all | all |
| EXEZNE | `s57-exezne` | — | z12+ | z12+ | z11+ |
| FAIRWY | `s57-fairwy` | — | all | all | all |
| FAIRWY | `s57-fairwy-outline` | — | all | all | all |
| FERYRT | `s57-feryrt` | — | all | all | all |
| FLODOC | `s57-flodoc` | — | all | all | all |
| FLODOC | `s57-flodoc-outline` | — | all | all | all |
| FOGSIG | `s57-fogsig` | — | z6+ | z6+ | z6+ |
| FORSTC | `s57-forstc` | — | z13+ | z13+ | z13+ |
| FORSTC | `s57-forstc-outline` | — | z13+ | z13+ | z13+ |
| FORSTC | `s57-forstc-symbol` | — | z12+ | z12+ | z12+ |
| FSHFAC | `s57-fshfac` | — | z11+ | z11+ | z10+ |
| FSHFAC | `s57-fshfac-line` | — | z11+ \* | z11+ \* | z10+ \* |
| GATCON | `s57-gatcon` | — | all | all | all |
| GATCON | `s57-gatcon-symbol` | — | z12+ | z12+ | z11+ |
| HRBFAC | `s57-hrbfac` | — | z14+ | z13+ | z12+ |
| HULKES | `s57-hulkes` | — | z13+ | z13+ | z13+ |
| HULKES | `s57-hulkes-outline` | — | z13+ | z13+ | z13+ |
| ISTZNE | `s57-istzne` | — | all | all | all |
| ISTZNE | `s57-istzne-outline` | — | all | all | all |
| LAKARE | `s57-lakare` | — | all | all | all |
| LIGHTS | `s57-lights` | — | z8+ \* | z6+ | z6+ |
| LIGHTS | `s57-lights-glow` | — | z8+ \* | z6+ | z6+ |
| LITFLT | `s57-litflt` | — | z10+ | z10+ | z10+ |
| LITVES | `s57-litves` | — | z10+ | z10+ | z10+ |
| LNDARE | `s57-lndare` | all | all | all | all |
| LNDARE | `s57-lndare-label` | — | z11+ \* | z11+ \* | z10+ \* |
| LNDARE | `s57-lndare-point` | z13+ \* | z13+ \* | z13+ \* | z12+ \* |
| LNDELV | `s57-lndelv-label` | z12+ | z12+ | z12+ | z11+ |
| LNDMRK | `s57-lndmrk` | — | z12+ | z12+ | z11+ |
| LNDRGN | `s57-lndrgn-label` | z11+ \* | z11+ \* | z11+ \* | z10+ \* |
| LNDRGN | `s57-lndrgn-marsh` | — | all \* | all \* | all \* |
| MARCUL | `s57-marcul` | — | z10+ \* | z10+ \* | z10+ \* |
| MARCUL | `s57-marcul-symbol` | — | z11+ | z11+ | z10+ |
| MIPARE | `s57-mipare` | — | all | all | all |
| MIPARE | `s57-mipare-symbol` | — | z10+ | z10+ | z9+ |
| MORFAC | `s57-morfac` | — | z12+ | z12+ | z11+ |
| NAVLNE | `s57-navlne` | — | all | all | all |
| OBSTRN | `s57-obstrn` | z10+ \* | z10+ \* | z10+ \* | z10+ \* |
| OBSTRN | `s57-obstrn-area` | z11+ \* | z11+ \* | z11+ \* | z11+ \* |
| OBSTRN | `s57-obstrn-foul` | z10+ \* | z10+ \* | z10+ \* | z10+ \* |
| OBSTRN | `s57-obstrn-foul-outline` | z10+ \* | z10+ \* | z10+ \* | z10+ \* |
| OBSTRN | `s57-obstrn-isodgr` | z10+ \* | z10+ \* | z10+ \* | z10+ \* |
| OBSTRN | `s57-obstrn-line` | z11+ \* | z11+ \* | z11+ \* | z11+ \* |
| OBSTRN | `s57-obstrn-sounding` | z12+ \* | z12+ \* | z12+ \* | z12+ \* |
| OFSPLF | `s57-ofsplf` | — | z14+ | z12+ | z11+ |
| OSPARE | `s57-ospare` | — | all | all | all |
| OSPARE | `s57-ospare-symbol` | — | z10+ | z10+ | z9+ |
| OVFALL | `s57-ovfall` | — | z10+ | z10+ | z10+ |
| PILBOP | `s57-pilbop` | — | all \* | all \* | all \* |
| PILBOP | `s57-pilbop-label` | — | all \* | all \* | all \* |
| PILBOP | `s57-pilbop-outline` | — | all \* | all \* | all \* |
| PILBOP | `s57-pilbop-point` | — | all \* | all \* | all \* |
| PILPNT | `s57-pilpnt` | — | — | z13+ | z12+ |
| PIPARE | `s57-pipare` | — | z12+ | z12+ | z11+ |
| PIPOHD | `s57-pipohd` | — | all | all | all |
| PIPOHD | `s57-pipohd-label` | — | z14+ \* | z14+ \* | z13+ \* |
| PIPSOL | `s57-pipsol` | — | z12+ | z12+ | z11+ |
| PONTON | `s57-ponton` | — | — | all | all |
| PRCARE | `s57-prcare` | — | all | all | all |
| PRCARE | `s57-prcare-outline` | — | all | all | all |
| PYLONS | `s57-pylons` | — | z14+ | z14+ | z13+ |
| RDOCAL | `s57-rdocal` | — | z10+ | z10+ | z10+ |
| RDOSTA | `s57-rdosta` | — | z10+ | z10+ | z10+ |
| RECTRC | `s57-rectrc` | — | all | all | all |
| RESARE | `s57-resare` | — | all | all | all |
| RESARE | `s57-resare-anchor-prohib` | — | z10+ \* | z10+ \* | z9+ \* |
| RESARE | `s57-resare-entry-prohib` | — | z10+ \* | z10+ \* | z9+ \* |
| RESARE | `s57-resare-fish-prohib` | — | z10+ \* | z10+ \* | z9+ \* |
| RETRFL | `s57-retrfl` | — | z10+ | z10+ | z10+ |
| RIVERS | `s57-rivers` | — | all | all | all |
| RSCSTA | `s57-rscsta` | — | z10+ | z10+ | z10+ |
| RTPBCN | `s57-rtpbcn` | — | z10+ | z10+ | z10+ |
| RUNWAY | `s57-runway` | — | z13+ | z13+ | z12+ |
| RUNWAY | `s57-runway-outline` | — | z13+ | z13+ | z12+ |
| SBDARE | `s57-sbdare` | — | z12+ | z12+ | z11+ |
| SEAARE | `s57-seaare-label` | — | z10+ \* | z10+ \* | z9+ \* |
| SILTNK | `s57-siltnk` | — | z14+ | z13+ | z12+ |
| SILTNK | `s57-siltnk-icon` | — | z14+ | z13+ | z12+ |
| SILTNK | `s57-siltnk-outline` | — | z14+ | z13+ | z12+ |
| SISTAT | `s57-sistat` | — | z10+ | z10+ | z10+ |
| SLCONS | `s57-slcons` | — | all \* | all \* | all \* |
| SLCONS | `s57-slcons-label` | — | — | z13+ \* | z12+ \* |
| SLCONS | `s57-slcons-submerged` | — | all \* | all \* | all \* |
| SLOGRD | `s57-slogrd` | — | all | all | all |
| SLOTOP | `s57-slotop` | — | all | all | all |
| SMCFAC | `s57-smcfac-label` | — | z12+ \* | z12+ \* | z11+ \* |
| SNDWAV | `s57-sndwav` | — | z11+ | z11+ | z11+ |
| SOUNDG | `s57-soundg` | all \* | all \* | all | all |
| SPLARE | `s57-splare` | — | z12+ | z12+ | z11+ |
| SPLARE | `s57-splare-outline` | — | z12+ | z12+ | z11+ |
| SPLARE | `s57-splare-symbol` | — | z12+ | z10+ | z9+ |
| SPRING | `s57-spring` | — | z11+ | z11+ | z11+ |
| SWPARE | `s57-swpare` | — | all | all | all |
| SWPARE | `s57-swpare-label` | — | all \* | all \* | all \* |
| TESARE | `s57-tesare` | — | z12+ | z12+ | z11+ |
| TOPMAR | `s57-topmar` | — | z8+ | z8+ | z8+ |
| TSEZNE | `s57-tsezne` | — | all | all | all |
| TSEZNE | `s57-tsezne-outline` | — | all | all | all |
| TSSBND | `s57-tssbnd` | — | all | all | all |
| TSSLPT | `s57-tsslpt` | — | all | all | all |
| TSSLPT | `s57-tsslpt-arrow` | — | z8+ \* | z8+ \* | z7+ \* |
| TSSRON | `s57-tssron` | — | all | all | all |
| TSSRON | `s57-tssron-outline` | — | all | all | all |
| TUNNEL | `s57-tunnel` | — | all | all | all |
| TWRTPT | `s57-twrtpt` | — | all | all | all |
| TWRTPT | `s57-twrtpt-outline` | — | all | all | all |
| UNSARE | `s57-unsare` | all | all | all | all |
| UNSARE | `s57-unsare-pattern` | all | all | all | all |
| UWTROC | `s57-uwtroc` | z10+ | z10+ | z10+ | z10+ |
| UWTROC | `s57-uwtroc-isodgr` | z10+ \* | z10+ \* | z10+ \* | z10+ \* |
| UWTROC | `s57-uwtroc-sounding` | z12+ \* | z12+ \* | z12+ \* | z12+ \* |
| VEGATN | `s57-vegatn` | — | all \* | all \* | all \* |
| VEGATN | `s57-vegatn-point` | — | z12+ \* | z12+ \* | z12+ \* |
| WATTUR | `s57-wattur` | — | z12+ | z12+ | z12+ |
| WATTUR | `s57-wattur-outline` | — | z12+ \* | z12+ \* | z12+ \* |
| WEDKLP | `s57-wedklp` | — | z11+ \* | z11+ \* | z11+ \* |
| WEDKLP | `s57-wedklp-outline` | — | z11+ \* | z11+ \* | z11+ \* |
| WRECKS | `s57-wrecks` | z10+ | z10+ | z10+ | z10+ |
| WRECKS | `s57-wrecks-isodgr` | z10+ \* | z10+ \* | z10+ \* | z10+ \* |
