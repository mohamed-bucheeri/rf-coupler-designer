# RF Coupler Designer

**Live site:** https://mohamed-bucheeri.github.io/rf-coupler-designer/

A browser calculator that designs RF power dividers and hybrid couplers for the band you need. Enter the frequency band, pick a circuit and how you will build it, and it gives you buildable part values or track sizes. It then simulates the result across your band, explains every number, and tells you when a method stops working.

Built by Mohamed Bucheeri, Communications and Networks Engineering, Bahrain Polytechnic.

## What it designs

| Circuit | Built with |
|---|---|
| Wilkinson power divider, 1, 2 or 3 sections | L and C parts, microstrip, stripline |
| Branch-line 90° hybrid | L and C parts, microstrip, stripline |
| Rat-race 180° hybrid | L and C parts, microstrip, stripline |

For each design it shows:

- **Pass or miss** against your target return loss and isolation, and the weakest point in the band.
- **Schematic and parts list** (or track widths and lengths), with formula values, optimised values and the standard E-series values to buy.
- **S-parameter curves** across the band, with the textbook-formula design as a dashed overlay.
- **Tolerance check:** 200 simulated builds with parts picked at random inside their tolerances.
- **Warnings** such as a lumped low-pass cutoff inside your band, tracks too narrow to make, or lines too long for a board.
- **How each number was found:** every step with its formula and the numbers filled in.

## Why it exists

The textbook way to make a lumped Wilkinson (replace each quarter-wave line with L = Z/ω₀ and C = 1/(ω₀Z)) is exact only at the centre frequency. Series inductors with shunt capacitors form a low-pass filter that cuts off at √2·f₀, so for a wide band like 10–30 MHz the formula values reflect most of the power at the top of the band. This tool detects that, optimises all values together across the band, and rounds them to parts you can buy.

## How it works

- **Simulator:** nodal admittance (Y-matrix) analysis of the whole circuit, giving full S-parameters at each frequency. Inductor and capacitor Q are included as series and parallel losses.
- **Lines:** Hammerstad–Jensen microstrip model with Kirschning–Jansen dispersion and conductor and dielectric loss; Cohn's exact stripline formula, with Wheeler's finite-thickness correction.
- **Multi-section Wilkinson:** line impedances by equal-ripple band search; two-section resistors from Cohn's closed-form design; three-section resistors by minimax search.
- **Optimiser:** differential evolution, minimising the worst in-band return loss, isolation, amplitude imbalance and phase error.
- **Standard values:** E12/E24/E96 rounding, then a neighbour search that keeps any swap improving the worst in-band point.

Everything runs in the browser. No server, no install.

## Checked against

- Cohn's two-section, 2:1 table: lines 1.6398 and 1.2197 × Z₀, resistors 1.9602 and 4.8204 × Z₀.
- Pozar's 50 Ω microstrip example (εr 2.2, h 1.27 mm): 3.91 mm.
- Pozar's 50 Ω stripline example (εr 2.2, b 3.2 mm): 2.66 mm.
- Steer's 400 MHz lumped Wilkinson: 28.13 nH, 5.627 pF, 100 Ω.
- A 10–30 MHz lumped Wilkinson built in Multisim, matching the calculator's AC sweep.

## Limits

Pads, vias, T-junctions, bends, the connector launch and part self-resonance are not modelled. Treat the result as a strong first design and confirm it in Qucs-S, Multisim or an EM simulator before ordering boards.

## Editing the code

The site is one file, `index.html`, so it can be hosted anywhere. It is built from the files in `src/`:

- `src/engine.js`: simulator, design formulas, line models, optimiser
- `src/ui.js`: form, schematic, charts and explanations
- `src/template.html`: page layout and styles

After editing, run `python3 src/build.py` to regenerate `index.html`.

## Sources

- S. B. Cohn, "A Class of Broadband Three-Port TEM-Mode Hybrids", IEEE Trans. MTT, vol. 16, no. 2, 1968.
- D. M. Pozar, *Microwave Engineering*, 4th ed.
- E. Hammerstad and Ø. Jensen (1980); M. Kirschning and R. H. Jansen (1982), as given in the [Qucs technical papers](https://qucs.sourceforge.net/tech/node75.html).
- M. Steer, [Wilkinson combiner and divider](https://eng.libretexts.org/Bookshelves/Electrical_Engineering/Electronics/Fundamentals_of_Microwave_and_RF_Design_(Steer)/09:_Passive_Components/9.10:_Wilkinson_Combiner_and_Divider).
- [Microwaves101, multistage Wilkinsons](https://www.microwaves101.com/encyclopedias/multistage-wilkinsons).
