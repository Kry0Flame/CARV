# CARV — Cut Accuracy Review and Verification
> **v2.4 · Rotary Tube Pro · RVS Corp**

CARV is a client-side G-code and engineering data checker designed to prevent errors in CNC pipe vessel fabrication. It automatically verifies that your CNC program (`.CNC` / `.txt` G-code) matches your design calculations (`.xml` exported from Codeware COMPRESS) before you cut steel.

---

## 💡 How It Works (Simply Explained)

Think of a steel vessel shell like a **can of soup with a paper label wrapped around it**:

1. **The CAD Design View (XML)**: COMPRESS models the nozzles in 3D using **Polar angles** (e.g. $90^\circ$, $180^\circ$ relative to the top center).
2. **The Workshop View (Drawing & G-code)**: On the shop floor and in the G-code, the cylinder is unwrapped "flat". The operator physically rotates the pipe weld seam to face the machine chuck's zero-point. This makes the **Weld Seam serve as the physical $0^\circ$ mechanical starting index**.

### What CARV Does:
* You load the vessel's **COMPRESS XML** and its corresponding **G-code program**.
* CARV reads the **Outer Diameter (OD)** to ensure they match.
* CARV "unwraps" the 3D XML nozzle angles, applies the **Seam Angle offset**, and translates them into the flat circumferential coordinates used by the machine.
* It matches each expected nozzle directly against the closest actual cut feature in the G-code.
* If any cut is missing, out-of-order, or misaligned by more than **$\pm 5^\circ$**, it sounds the alarm!

---

## ⚙️ Core Checking Logic

### 1. Nozzle Sorting & Priority Order
To match standard shop layouts, CARV categorizes and prioritizes nozzles dynamically:
*   **Pipes (Group 1)**: Any nozzle whose specifications mention `"pipe"` or `"tube"`. They sort **largest nominal size to smallest nominal size**.
*   **Couplings (Group 2)**: Any nozzle whose tags mention `"coupling"`, `"cplg"`, or `"fitting"`. They sort **largest nominal size to smallest nominal size**.
*   **Other (Group 3)**: Any auxiliary fitting, sorted **largest to smallest OD**.
*   *Sub-sorting*: Matching sizes (e.g., multiple $3\text{-inch}$ connections) are sorted naturally by their designator identifiers (e.g., `COIL RETURN #1` before `COIL RETURN #2`).

### 2. Shell Seam Classification
CARV classifies the shell to determine how the weld seam offset is established:
*   **Seamless Pipe** (`Smls.` or `Seamless` product form):
    *   *Logic*: Seamless pipe has no weld seam.
    *   *Behavior*: Auto-sets the seam offset to `0°`, bypasses warnings, and displays **"Seamless"**.
*   **Welded Pipe** (`Wld. Pipe` product form):
    *   *Logic*: The longitudinal weld seam exists, but its rotation in G-code is arbitrary depending on how the operator chucks it.
    *   *Behavior*: Triggers a yellow warning prompting the operator to **manually input** the chuck alignment angle.
*   **Rolled Plate Shell** (Flat plates rolled and welded in-shop):
    *   *Logic*: The long weld seam is mathematically designed at a set orientation angle in the CAD model.
    *   *Behavior*: Automatically extracts `<longSeamAngle>` from `<longSeam>` (or `<LongSeamStartingAngle>`) and green-highlights it as **"Auto-detected"**.

### 3. End-Cut Filtering
G-code files frequently contain trim/facing cuts at the extreme far ends of the pipe to face it. CARV automatically scans all linear coordinates, isolates the extreme left and right cuts as **Pipe End Cuts**, and filters them out so they do not trigger false mismatches against your nozzles.

---

## 📁 Codebase Architecture

```text
Program/CARV/
├── index.html          # Semantic HTML page with robust Content Security Policy (CSP)
├── styles.css          # Sleek, industrial dark-theme stylesheet
├── src/
│   ├── main.js         # Core orchestrator; handles event wiring, dropzones, and main loop
│   ├── state.js        # Central store; single source of truth for the session state
│   ├── config/
│   │   ├── nozzles.js  # Tuning constants: tolerances (±5° check, ±15° warn, ±0.1" OD check)
│   │   └── pdf.js      # Layout tuning constants
│   ├── domain/
│   │   ├── angles.js   # Coordinate transformation math (Horizontal/Vertical seam formulas)
│   │   └── validate.js # Greedy matching engine & end-cut isolation algorithm
│   ├── parsers/
│   │   ├── cnc.js      # Stateful G-code trace parser (coordinates, absolute/relative modes)
│   │   └── xml.js      # Secure browser-based namespace-insensitive DOMParser
│   └── ui/
│       ├── dropzone.js # Drag-and-drop elements with defensive cached-file guards
│       ├── results.js  # Render results list, tables, and warnings
│       ├── debug.js    # Renders the G-code G-code compiler console log
│       └── toast.js    # Standard toast notification dispatch
└── Test Material/      # Reference test files (26p208431.xml and 08431.CNC)
```
