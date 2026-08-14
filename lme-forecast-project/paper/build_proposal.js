const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
  TableCell, WidthType, AlignmentType, BorderStyle, ShadingType,
  Numbering, LevelFormat, convertInchesToTwip } = require("docx");
const fs = require("fs");

const H1 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } });
const H2 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } });
const P = (text, opts = {}) => new Paragraph({
  children: [new TextRun({ text, ...opts })],
  spacing: { after: 160 },
  alignment: AlignmentType.JUSTIFIED,
});
const Bullet = (text) => new Paragraph({
  text,
  numbering: { reference: "bullet-list", level: 0 },
  spacing: { after: 80 },
});

function cell(text, opts = {}) {
  return new TableCell({
    width: { size: opts.width || 2000, type: WidthType.DXA },
    shading: opts.header ? { fill: "2F5496", type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: !!opts.header, color: opts.header ? "FFFFFF" : "000000", size: 20 })],
    })],
  });
}

const timelineRows = [
  ["Weeks", "Focus", "Deliverable"],
  ["1-2", "Literature review; finalize research question and novelty scope", "Proposal document (this document)"],
  ["3-4", "Data pipeline: zinc/aluminium prices, warehouse inventory, macro features", "Cleaned dataset + EDA notes"],
  ["5-6", "Implement and validate individual base experts (ARIMA, XGBoost, sequence model) as baselines", "Baseline performance table"],
  ["7-9", "Design and implement the gating network; formalize architecture mathematically", "Working gated MoE prototype"],
  ["10-11", "Train end-to-end; run ablation studies (inventory signal, regime signal, vs. simple ensembling)", "Ablation results table"],
  ["12-13", "Build Streamlit demo app (forecast + live gate-weight visualization)", "Working demo application"],
  ["14-15", "Write paper draft; prepare final report and presentation", "Final report, paper draft, presentation"],
];

const table = new Table({
  width: { size: 9000, type: WidthType.DXA },
  columnWidths: [1200, 4800, 3000],
  rows: timelineRows.map((row, i) => new TableRow({
    children: [
      cell(row[0], { header: i === 0, width: 1200 }),
      cell(row[1], { header: i === 0, width: 4800 }),
      cell(row[2], { header: i === 0, width: 3000 }),
    ],
  })),
});

const doc = new Document({
  numbering: {
    config: [{
      reference: "bullet-list",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.15) } } } }],
    }],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 } } }, // US Letter
    children: [
      new Paragraph({
        children: [new TextRun({ text: "Project Proposal", bold: true, size: 28, color: "2F5496" })],
        spacing: { after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({
          text: "A Regime- and Inventory-Conditioned Gated Mixture-of-Experts Architecture for Forecasting LME Zinc and Aluminium Prices",
          bold: true, size: 36,
        })],
        spacing: { after: 300 },
      }),
      P("Course: [Insert course name / code]  |  Credits: 3  |  Duration: 1 Semester"),
      P("Student: [Your name]  |  Guide: [Guide's name]  |  Department: [Department name]"),

      H1("1. Objective"),
      P("This project designs, implements, and evaluates a novel forecasting architecture for London Metal Exchange (LME) zinc and aluminium prices. The core contribution is a Mixture-of-Experts (MoE) ensemble whose gating network is conditioned on market-regime indicators and a custom-derived warehouse-inventory-pressure index, rather than on fixed or naively input-agnostic weighting schemes used in prior ensemble approaches."),

      H1("2. Background and Motivation"),
      P("Base metal prices such as zinc and aluminium are notoriously difficult to forecast due to their sensitivity to industrial demand cycles, macroeconomic shocks, and physical supply-chain signals such as exchange warehouse inventory levels. Classical statistical models (ARIMA, ETS) capture linear structure well but struggle with regime shifts; machine learning models (gradient boosting, LSTM) capture nonlinearity but are typically deployed as single, static models that do not adapt their internal logic to changing market conditions."),
      P("Ensemble methods that combine multiple models are well established, and dynamic, learned-gating (Mixture-of-Experts) ensembles have shown promise in adjacent domains — financial time series generally, and even a historical application to platinum price prediction using time- and input-conditioned expert weighting. However, no existing published work combines a learned gating mechanism with domain-specific fundamental signals — specifically, warehouse inventory pressure — for LME base metals forecasting. This project fills that gap."),

      H1("3. Literature Review Summary"),
      P("Prior work establishes three relevant threads:"),
      Bullet("Mixture-of-Experts / dynamic gating ensembles have been applied to general financial time series and, in earlier work, specifically to platinum price prediction, using weights that vary with input region and time."),
      Bullet("Recent stock-forecasting MoE studies condition gates on volatility regime, but explicitly note that static, predetermined weighting is a limitation and call for more dynamic, learning-based gating architectures — a gap this project addresses directly for a different asset class."),
      Bullet("Separate work on base-metals forecasting incorporates macroeconomic and inventory variables, but through standard multivariate/statistical frameworks (e.g. VAR/BVAR) where inventory is one static input feature, not a signal that reshapes how an ensemble dynamically weights its component models."),
      P("The identified gap: a gating architecture that is (a) dynamically learned, (b) conditioned on a purpose-built inventory-pressure index, and (c) applied specifically to LME zinc and aluminium, has not been published. [Full citation list to be compiled in the literature review phase, Weeks 1-2.]"),

      H1("4. Proposed Methodology"),
      H2("4.1 Base Experts"),
      Bullet("Expert A — ARIMA/ETS: captures linear trend and seasonal structure."),
      Bullet("Expert B — Gradient Boosting (XGBoost) on engineered lag/technical features: captures short-term nonlinear patterns."),
      Bullet("Expert C — Sequence model (LSTM/GRU): captures longer temporal dependencies from raw price sequences."),

      H2("4.2 Gating Network (Core Contribution)"),
      P("The gating network is a small neural network that takes a market-state vector s_t as input and produces a softmax-normalized weight for each expert. The final forecast is a weighted combination:"),
      new Paragraph({
        children: [new TextRun({ text: "ŷ_t = Σ_i  g_i(s_t) · f_i(x_t),   where g_i(s_t) = softmax( score_i(s_t) )", italics: true })],
        spacing: { after: 160 }, alignment: AlignmentType.CENTER,
      }),
      P("The market-state vector s_t includes: rolling return volatility, a regime indicator (Hurst exponent / trend-vs-mean-reversion classification), each expert's recent rolling forecast error, and the novel inventory-pressure index, defined as a rolling z-scored combination of warehouse stock level, its rate of change, and its volatility, capturing physical supply tightness beyond what a raw stock-level feature conveys."),

      H2("4.3 Evaluation and Ablations"),
      P("Models are evaluated using rolling-window backtesting (not a single train/test split) with MAE, RMSE, and directional accuracy. Planned ablations: (i) gated model vs. simple average ensemble vs. best single expert vs. naive persistence baseline; (ii) gated model with vs. without the inventory-pressure signal; (iii) gated model with vs. without the regime signal. These ablations are the primary evidence for the paper's claim that the novel components add real value, not just architectural complexity."),

      H1("5. Data Sources"),
      Bullet("LME official data: free for the current calendar year (next-day delayed) via lme.com; historical archives available for purchase."),
      Bullet("World Bank Pink Sheet: free monthly commodity price data (aluminium, zinc) extending back decades."),
      Bullet("Yahoo Finance (yfinance): free daily aluminium futures data; zinc daily data will require a supplementary source (e.g. Metals-API trial tier) given no direct free daily zinc feed was identified."),
      Bullet("LME warehouse stock reports: source for the inventory-pressure index."),
      Bullet("Auxiliary macro indicators: USD index, oil price, as commonly used covariates in base-metals literature."),

      H1("6. Timeline"),
      table,

      H1("7. Expected Outcomes and Deliverables"),
      Bullet("A working, documented codebase implementing the gated MoE architecture."),
      Bullet("A Streamlit-based interactive demo application (forecast + live gate-weight visualization)."),
      Bullet("Ablation study results quantifying the contribution of the novel gating signals."),
      Bullet("A written paper draft suitable for submission to a relevant venue, with the architecture and inventory-pressure index as the primary claimed contributions."),
      Bullet("A final report and presentation for course evaluation."),

      H1("8. Note on Intellectual Property"),
      P("This proposal targets a peer-reviewed paper as the primary output. Algorithms and mathematical methods are generally not independently patentable subject matter in most jurisdictions (including India) unless embodied in a specific technical system producing a defined technical effect; any exploration of patent protection for this work will be pursued separately in consultation with the institution's IP cell, and does not affect the academic research plan above."),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("Project_Proposal.docx", buf);
  console.log("Written Project_Proposal.docx");
});
