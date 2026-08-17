# BG Amendment Mailer

A PowerShell tool that turns a Bank Guarantee (BG) tracking workbook into ready-to-send
Outlook draft emails — one per job — requesting extension/amendment approval, with a neatly
formatted HTML summary table of every BG involved.

Built during a procurement internship at **Acme Renewables** to remove the repetitive,
error-prone manual work of composing BG amendment emails by hand.

> ⚠️ **No company data is included.** The real BG master workbook and generated email drafts
> are git-ignored. A synthetic sample (`BG_Master_SAMPLE.xlsx`) with fictional projects,
> banks, and email addresses is provided so the tool can be demonstrated end-to-end.

---

## What it does

- Reads a workbook with a sheet named **`BG_Data`** (one row per Bank Guarantee).
- **Groups** BGs by Job Code + recipient, so all BGs for one job go into a single email.
- Builds a styled **HTML table** comparing existing vs. revised validity, claim period and
  BG value, with Indian-format currency (e.g. `12,50,000.00`).
- Writes each email as a standard **`.eml`** draft (with `X-Unsent: 1`, so Outlook opens it
  as a new, editable, unsent message) into `bg_email_drafts/`.
- **Two modes:**
  - **Team mode** (`BG-Mail-Team.bat`) — addresses each draft to the recipient listed in the
    workbook.
  - **Head mode** (`BG-Mail-Head.bat`) — routes every draft to a single approver
    (`-HeadApproverEmail`) with an *"Approval Required"* subject prefix, for sign-off.

## How to run

Requires Windows PowerShell (5.1+). No modules to install — it reads `.xlsx` directly by
unzipping the OOXML and parsing the sheet XML.

```powershell
# Preview what would be sent (no files written)
.\BG-Mail.ps1 -WorkbookPath .\BG_Master_SAMPLE.xlsx -PreviewOnly

# Generate .eml drafts from the sample and open them
.\BG-Mail.ps1 -WorkbookPath .\BG_Master_SAMPLE.xlsx -OpenDrafts

# Head/approval mode, routed to one approver
.\BG-Mail.ps1 -WorkbookPath .\BG_Master_SAMPLE.xlsx -OpenDrafts -HeadMode -HeadApproverEmail "approver@example.com"
```

The `.bat` files are one-click wrappers around these commands (they default to the real
workbook name, so pass `-WorkbookPath` to point them at the sample).

## Key parameters

| Parameter            | Purpose                                                        |
|----------------------|----------------------------------------------------------------|
| `-WorkbookPath`      | Path to the BG workbook (defaults to the production file name) |
| `-PreviewOnly`       | Print a summary of each email; write nothing                   |
| `-OpenDrafts`        | Open each generated `.eml` after writing                       |
| `-HeadMode`          | Route all drafts to one approver with an approval subject      |
| `-HeadApproverEmail` | The approver address used in Head mode                         |

## Expected workbook layout

Sheet **`BG_Data`**, header in row 1, one BG per row. Columns are read **by position**:

| Col | Field | Col | Field | Col | Field |
|-----|-------|-----|-------|-----|-------|
| A | Segment | H | Existing Claim Period | O | Job Name |
| B | Portal Req. No. | I | Revised Validity | P | Printing & Payable |
| C | **BG Number** (required) | J | Revised Claim Period | Q | Stamp Duty |
| D | BG Date | K | Revised BG Value | R | Issuing Bank / IFSC |
| E | BG Type | L | Existing BG Value | S | Client GST |
| F | Beneficiary | M | Issuing Bank | T | BG Clause |
| G | Existing Validity | N | Job Code | U / V | To / CC addresses |

See `BG_Master_SAMPLE.xlsx` for a working example.

## Tech

PowerShell · OOXML/`.xlsx` parsing via `System.IO.Compression` · MIME `multipart/alternative`
`.eml` generation · HTML/CSS email templating.

## License

[MIT](LICENSE)
