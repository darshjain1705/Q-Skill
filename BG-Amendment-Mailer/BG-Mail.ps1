param(
  [string]$WorkbookPath = "",
  [string]$JobCode = "",
  [switch]$PreviewOnly,
  [switch]$OpenDrafts,
  [string]$DraftFolder = "",
  [switch]$HeadMode,
  [string]$HeadApproverEmail = "approver@example.com",
  [string]$ParameterColWidth = "200px",
  [string]$DetailsColWidth = "420px",
  [string]$RowHeight = "25px",
  [string]$RemarksRowHeight = "60px"
)

$ErrorActionPreference = "Stop"

function HtmlEncode($value) {
  if ($null -eq $value) { return "" }
  return [System.Net.WebUtility]::HtmlEncode([string]$value)
}

function FileSafe($value) {
  $name = [string]$value
  foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) {
    $name = $name.Replace($c, "_")
  }
  return $name.Trim()
}

function EncodeHeader($value) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$value)
  return "=?utf-8?B?$([Convert]::ToBase64String($bytes))?="
}

function ExcelDate($value) {
  if ([string]::IsNullOrWhiteSpace([string]$value)) { return "" }
  $n = 0.0
  if ([double]::TryParse([string]$value, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$n)) {
    return ([datetime]"1899-12-30").AddDays($n).ToString("dd-MM-yyyy")
  }
  $d = [datetime]::MinValue
  if ([datetime]::TryParse([string]$value, [ref]$d)) { return $d.ToString("dd-MM-yyyy") }
  return ([string]$value).Trim()
}

function IndianMoney($value) {
  if ([string]::IsNullOrWhiteSpace([string]$value)) { return "" }
  $n = 0.0
  if (![double]::TryParse([string]$value, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$n)) {
    return ([string]$value).Trim()
  }
  $neg = $n -lt 0
  $n = [math]::Abs($n)
  $fixed = "{0:F2}" -f $n
  $parts = $fixed.Split(".")
  $whole = $parts[0]
  $frac = $parts[1]
  if ($whole.Length -gt 3) {
    $last3 = $whole.Substring($whole.Length - 3)
    $rest = $whole.Substring(0, $whole.Length - 3)
    $chunks = New-Object System.Collections.Generic.List[string]
    while ($rest.Length -gt 2) {
      $chunks.Insert(0, $rest.Substring($rest.Length - 2))
      $rest = $rest.Substring(0, $rest.Length - 2)
    }
    if ($rest.Length) { $chunks.Insert(0, $rest) }
    $chunks.Add($last3)
    $whole = $chunks -join ","
  }
  return ("$(if($neg){'-'})$whole.$frac")
}

function LoadSharedStrings($zip) {
  $entry = $zip.GetEntry("xl/sharedStrings.xml")
  $strings = @()
  if (!$entry) { return $strings }
  $stream = $entry.Open()
  try {
    [xml]$xml = New-Object xml
    $xml.PreserveWhitespace = $false
    $xml.Load($stream)
    foreach ($si in $xml.sst.si) {
      $parts = @()
      if ($si.t) { $parts += [string]$si.t }
      if ($si.r) {
        foreach ($r in $si.r) { if ($r.t) { $parts += [string]$r.t } }
      }
      $strings += ($parts -join "")
    }
  } finally {
    $stream.Close()
  }
  return $strings
}

function GetCellColumn($ref) {
  return ([regex]::Match([string]$ref, "^[A-Z]+")).Value
}

function GetCellText($cell, $sharedStrings) {
  $type = [string]$cell.t
  if ($type -eq "s") {
    $idx = 0
    if ([int]::TryParse([string]$cell.v, [ref]$idx) -and $idx -lt $sharedStrings.Count) { return $sharedStrings[$idx] }
    return ""
  }
  if ($type -eq "inlineStr") {
    if ($cell.is -and $cell.is.t) { return [string]$cell.is.t }
    return ""
  }
  if ($cell.v) { return [string]$cell.v }
  return ""
}

function GetSheetPath($zip, $sheetName) {
  $wbEntry = $zip.GetEntry("xl/workbook.xml")
  $relEntry = $zip.GetEntry("xl/_rels/workbook.xml.rels")
  if (!$wbEntry -or !$relEntry) { throw "Invalid workbook structure." }

  $wbStream = $wbEntry.Open()
  $relStream = $relEntry.Open()
  try {
    [xml]$wb = New-Object xml
    [xml]$rels = New-Object xml
    $wb.Load($wbStream)
    $rels.Load($relStream)
    $sheet = $wb.workbook.sheets.sheet | Where-Object { $_.name -eq $sheetName } | Select-Object -First 1
    if (!$sheet) { throw "Sheet not found: $sheetName" }
    $rid = $sheet.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
    $rel = $rels.Relationships.Relationship | Where-Object { $_.Id -eq $rid } | Select-Object -First 1
    if (!$rel) { throw "Sheet relationship not found for: $sheetName" }
    return ("xl/" + ([string]$rel.Target).TrimStart("/"))
  } finally {
    $wbStream.Close()
    $relStream.Close()
  }
}

function ReadBgData($workbookPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($workbookPath)
  try {
    $sharedStrings = LoadSharedStrings $zip
    $sheetPath = GetSheetPath $zip "BG_Data"
    $entry = $zip.GetEntry($sheetPath)
    if (!$entry) { throw "BG_Data sheet file not found." }
    $stream = $entry.Open()
    try {
      [xml]$xml = New-Object xml
      $xml.Load($stream)
      $records = @()
      foreach ($row in $xml.worksheet.sheetData.row) {
        $rowNum = [int]$row.r
        if ($rowNum -le 1) { continue }
        if ($row.GetAttribute("hidden") -eq "1" -or $row.GetAttribute("hidden") -eq "true") { continue }
        $cells = @{}
        foreach ($c in $row.c) {
          $cells[(GetCellColumn $c.r)] = GetCellText $c $sharedStrings
        }
        if ([string]::IsNullOrWhiteSpace($cells["C"])) { continue }
        $record = [pscustomobject]@{
          Segment         = [string]$cells["A"]
          PortalReqNo     = [string]$cells["B"]
          BGNumber        = [string]$cells["C"]
          BGDate          = ExcelDate $cells["D"]
          BGType          = [string]$cells["E"]
          Beneficiary     = [string]$cells["F"]
          Validity        = ExcelDate $cells["G"]
          ClaimPeriod     = ExcelDate $cells["H"]
          RevisedValidity = ExcelDate $cells["I"]
          RevisedClaim    = ExcelDate $cells["J"]
          RevisedBGValue  = IndianMoney $cells["K"]
          BGValue         = IndianMoney $cells["L"]
          Bank            = [string]$cells["M"]
          JobCode         = [string]$cells["N"]
          JobName         = [string]$cells["O"]
          PrintingPayable = [string]$cells["P"]
          StampDuty       = [string]$cells["Q"]
          BankIFSC        = [string]$cells["R"]
          ClientGST       = [string]$cells["S"]
          BGClause        = [string]$cells["T"]
          ToAddress       = ([string]$cells["U"]).Replace(",", ";")
          CCAddress       = ([string]$cells["V"]).Replace(",", ";")
        }
        if ($JobCode -and $record.JobCode -ne $JobCode) { continue }
        $records += $record
      }
      return $records
    } finally {
      $stream.Close()
    }
  } finally {
    $zip.Dispose()
  }
}

function BuildCombinedTable($records) {
  $paramNames = @(
    "Job Code", "Job Name", "Portal Req. No.", "BG Number", "BG Date", "BG Type",
    "Beneficiary", "Existing Validity", "Existing Claim Period",
    "Revised Validity", "Revised Claim Period", "Existing BG Value",
    "Revised BG Value", "Issuing Bank / IFSC", "Stamp Duty", "Client GST",
    "Printing & Payable"
  )

  # Collect values for each BG as a separate array
  $allValues = @()
  foreach ($rec in $records) {
    $vals = @(
      $rec.JobCode, $rec.JobName, $rec.PortalReqNo, $rec.BGNumber,
      $rec.BGDate, $rec.BGType, $rec.Beneficiary, $rec.Validity,
      $rec.ClaimPeriod, $rec.RevisedValidity, $rec.RevisedClaim,
      ("INR " + $rec.BGValue + "/-"), ("INR " + $rec.RevisedBGValue + "/-"),
      $rec.BankIFSC, $rec.StampDuty, $rec.ClientGST, $rec.PrintingPayable
    )
    $allValues += ,($vals)
  }

  $indicesToInclude = 0..16
  if ($HeadMode) {
    # Keep only: Job Code (0), Job Name (1), BG Number (3), BG Date (4), BG Type (5), Beneficiary (6),
    # Existing Validity (7), Existing Claim Period (8), Revised Validity (9), Revised Claim Period (10),
    # Existing BG Value (11), Revised BG Value (12)
    $indicesToInclude = @(0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
  }

  $filteredParamNames = @()
  foreach ($idx in $indicesToInclude) {
    $filteredParamNames += $paramNames[$idx]
  }

  $filteredAllValues = @()
  foreach ($vals in $allValues) {
    $filteredVals = @()
    foreach ($idx in $indicesToInclude) {
      $filteredVals += $vals[$idx]
    }
    $filteredAllValues += ,($filteredVals)
  }

  $colCount = $records.Count
  $totalCols = $colCount + 1

  # Extract numeric width and height values for Outlook support
  $paramWidthVal = [int]([regex]::Match($ParameterColWidth, "\d+")).Value
  $detailsWidthVal = [int]([regex]::Match($DetailsColWidth, "\d+")).Value
  $rowHeightVal = [int]([regex]::Match($RowHeight, "\d+")).Value
  $remarksHeightVal = [int]([regex]::Match($RemarksRowHeight, "\d+")).Value

  if (!$paramWidthVal) { $paramWidthVal = 200 }
  if (!$detailsWidthVal) { $detailsWidthVal = 420 }
  if (!$rowHeightVal) { $rowHeightVal = 25 }
  if (!$remarksHeightVal) { $remarksHeightVal = 60 }
  $tableWidth = $paramWidthVal + ($detailsWidthVal * $colCount)

  # Header row
  $headerHtml = "<th width='$paramWidthVal' height='$rowHeightVal' style='width: ${paramWidthVal}px; height: ${rowHeightVal}px; background-color: #4e4d3c; color: #ffffff; border: 1px solid #b4b4b4; padding: 6px 12px; text-align: left; font-weight: 700; font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt;'>Parameter</th>"
  if ($colCount -eq 1) {
    $headerHtml += "<th width='$detailsWidthVal' height='$rowHeightVal' style='width: ${detailsWidthVal}px; height: ${rowHeightVal}px; background-color: #4e4d3c; color: #ffffff; border: 1px solid #b4b4b4; padding: 6px 12px; text-align: left; font-weight: 700; font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt;'>Details</th>"
  } else {
    for ($i = 0; $i -lt $colCount; $i++) {
      $headerHtml += "<th width='$detailsWidthVal' height='$rowHeightVal' style='width: ${detailsWidthVal}px; height: ${rowHeightVal}px; background-color: #4e4d3c; color: #ffffff; border: 1px solid #b4b4b4; padding: 6px 12px; text-align: left; font-weight: 700; font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt;'>Details - BG $($i + 1)</th>"
    }
  }

  # Data rows
  $rowsHtml = ""
  for ($p = 0; $p -lt $filteredParamNames.Count; $p++) {
    $rowsHtml += "<tr height='$rowHeightVal' style='height: ${rowHeightVal}px;'><td width='$paramWidthVal' style='width: ${paramWidthVal}px; height: ${rowHeightVal}px; background-color: #dfdcce; color: #222222; border: 1px solid #b4b4b4; padding: 6px 12px; font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; font-weight: 700;'>$(HtmlEncode $filteredParamNames[$p])</td>"
    for ($c = 0; $c -lt $colCount; $c++) {
      $rowsHtml += "<td width='$detailsWidthVal' style='width: ${detailsWidthVal}px; height: ${rowHeightVal}px; background-color: #ffffff; color: #222222; border: 1px solid #cccccc; padding: 6px 12px; font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt;'>$(HtmlEncode $filteredAllValues[$c][$p])</td>"
    }
    $rowsHtml += "</tr>`n"
  }

  # BG Clause row (column-wise for both Team and Head modes)
  $clauseHtml = "<tr height='$remarksHeightVal' style='height: ${remarksHeightVal}px;'><td width='$paramWidthVal' style='width: ${paramWidthVal}px; height: ${remarksHeightVal}px; vertical-align: top; background-color: #dfdcce; color: #222222; border: 1px solid #b4b4b4; padding: 6px 12px; font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; font-weight: 700;'>BG Clause and Remarks</td>"
  for ($c = 0; $c -lt $colCount; $c++) {
    $clauseHtml += "<td width='$detailsWidthVal' style='width: ${detailsWidthVal}px; height: ${remarksHeightVal}px; vertical-align: top; background-color: #ffffff; color: #222222; border: 1px solid #cccccc; padding: 6px 12px; font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt;'>$(HtmlEncode $records[$c].BGClause)</td>"
  }
  $clauseHtml += "</tr>"

@"
<table width="$tableWidth" border="1" bordercolor="#cccccc" cellpadding="0" cellspacing="0" style="width: ${tableWidth}px; border-collapse: collapse; margin: 10px 0 18px 0; border: 1px solid #cccccc;">
  <thead><tr>$headerHtml</tr></thead>
  <tbody>
    $rowsHtml
    $clauseHtml
  </tbody>
</table>
"@
}

function SaveEmlDraft($folder, $to, $cc, $subject, $htmlBody, $index, $fileNameHint) {
  if (!(Test-Path -LiteralPath $folder)) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
  }
  $boundary = "----=_BG_AMENDMENT_$([Guid]::NewGuid().ToString("N"))"
  $safeName = FileSafe ("{0:00}_{1}.eml" -f $index, $fileNameHint)
  $path = Join-Path $folder $safeName

  # Trim leading/trailing spaces and semicolons to ensure valid email header format
  if ($to) { $to = $to.Trim(' ', ';') }
  if ($cc) { $cc = $cc.Trim(' ', ';') }

  $headers = [System.Collections.Generic.List[string]]::new()
  if (![string]::IsNullOrWhiteSpace($to)) {
    $headers.Add("To: $to")
  }
  if (![string]::IsNullOrWhiteSpace($cc)) {
    $headers.Add("Cc: $cc")
  }
  $headers.Add("Subject: $(EncodeHeader $subject)")
  $headers.Add("MIME-Version: 1.0")
  $headers.Add("Content-Type: multipart/alternative; boundary=""$boundary""")
  $headers.Add("X-Unsent: 1")

  $headersText = $headers -join "`r`n"

  $eml = @"
$headersText

--$boundary
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: base64

$([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($htmlBody), [Base64FormattingOptions]::InsertLineBreaks))
--$boundary--
"@

  # Normalize all line endings to strict CRLF as required by SMTP/EML specs
  $eml = $eml -replace "`r`n", "`n" -replace "`n", "`r`n"

  [System.IO.File]::WriteAllText($path, $eml)
  return $path
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (!$WorkbookPath) {
  $WorkbookPath = Join-Path $scriptDir "BG_Master_SAMPLE.xlsx"
}
if (!$DraftFolder) {
  $DraftFolder = Join-Path $scriptDir "bg_email_drafts"
}
if (!(Test-Path -LiteralPath $WorkbookPath)) {
  throw "Workbook not found: $WorkbookPath"
}

# Clean up old .eml drafts so stale files don't persist across runs
if (!$PreviewOnly -and (Test-Path -LiteralPath $DraftFolder)) {
  $oldDrafts = Get-ChildItem -LiteralPath $DraftFolder -Filter "*.eml" -File -ErrorAction SilentlyContinue
  if ($oldDrafts) {
    $oldDrafts | Remove-Item -Force
    Write-Host "Cleared $($oldDrafts.Count) old draft(s) from $DraftFolder"
  }
}

$records = @(ReadBgData $WorkbookPath)
if (!$records.Count) {
  Write-Host "No BG_Data rows found."
  exit 0
}

$groups = @($records | Group-Object JobCode, ToAddress, CCAddress)

if ($PreviewOnly) {
  foreach ($group in $groups) {
    $items = @($group.Group)
    $first = $items[0]
    $bgNums = ($items | ForEach-Object { $_.BGNumber }) -join ' | '
    $to = if ($HeadMode) { $HeadApproverEmail } else { $first.ToAddress }
    $cc = if ($HeadMode) { "" } else { $first.CCAddress }
    $subjPrefix = if ($HeadMode) { "Approval Required: " } else { "" }
    Write-Host "Job Code: $($first.JobCode)"
    Write-Host "Subject : $($subjPrefix)BG Extension/Amendment | $bgNums | $($first.JobCode) - $($first.JobName) | $($first.Beneficiary)"
    Write-Host "To      : $to"
    Write-Host "CC      : $cc"
    Write-Host "BG Nos  : $(($items | ForEach-Object { $_.BGNumber }) -join ', ')"
    Write-Host ""
  }
  exit 0
}

$draftIndex = 0
foreach ($group in $groups) {
  $draftIndex += 1
  $items = @($group.Group)
  $first = $items[0]
  $bgNums = ($items | ForEach-Object { $_.BGNumber }) -join ' | '
  $to = $first.ToAddress
  if ($HeadMode) {
    $to = $HeadApproverEmail
  }
  
  $subjPrefix = if ($HeadMode) { "Approval Required: " } else { "" }
  $subject = "$($subjPrefix)BG Extension/Amendment | $bgNums | $($first.JobCode) - $($first.JobName) | $($first.Beneficiary)"
  $tables = BuildCombinedTable $items
  
  $tableStyles = @"
  .bg-table { width:100% border-collapse: collapse; margin: 0px 0 0px 0; }
  .bg-table th { background: #4e4d3c; color: #ffffff; border: 1px solid #b4b4b4; padding: 0px 0px; text-align: left; font-weight: 700; }
  .bg-table td { background: #ffffff; color: #222222; border: 1px solid #cccccc; padding: 0px 0px; }
  .bg-table .param { background: #dfdcce; font-weight: 700; width: $ParameterColWidth; color: #222222; border: 1px solid #b4b4b4; }
  .bg-table .remarks { height: 40px; vertical-align: top; }
"@

  $bodyStart = ""
  if ($HeadMode) {
    $bodyStart = @"
  <p style="font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; color: #111111; margin: 0 0 12px 0;">Dear Sir,</p>
  <p style="font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; color: #111111; margin: 0 0 12px 0;">Requesting your approval for the extension/amendment of the Bank Guarantee for <strong>$(HtmlEncode $first.JobCode)- $(HtmlEncode $first.JobName)</strong>. Please find the details below for your perusal.</p>
"@
  } else {
    $bodyStart = @"
  <p style="font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; color: #111111; margin: 0 0 12px 0;">Dear Team,</p>
  <p style="font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; color: #111111; margin: 0 0 12px 0;">This has reference to the BG extension/amendment for <strong>$(HtmlEncode $first.JobCode) - $(HtmlEncode $first.JobName)</strong>. All relevant document enclosures are attached for your review and processing.</p>
"@
  }

  $body = @"
<html>
<head>
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>
  :root {
    color-scheme: light;
    supported-color-schemes: light;
  }
  body { font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; color: #111111; background-color: #ffffff; }
  $tableStyles
</style>
</head>
<body>
  $bodyStart
  $tables
  <p style="font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; color: #111111; margin: 12px 0 0 0;">Best Regards,<br>
  Mayank Ranka<br>
  MIS Coordinator | Renewables INDIA</p>
</body>
</html>
"@
  $cc = $first.CCAddress
  if ($HeadMode) {
    $cc = ""
  }

  $prefix = "BG_Amendment_"
  if ($HeadMode) {
    $prefix = "Head_Approval_Required_"
  }
  $fileNameHint = $prefix + $first.JobCode
  $path = SaveEmlDraft $DraftFolder $to $cc $subject $body $draftIndex $fileNameHint
  Write-Host "EML draft created: $path"
  if ($OpenDrafts) {
    Start-Process -FilePath $path
  }
}
