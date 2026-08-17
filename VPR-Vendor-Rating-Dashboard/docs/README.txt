=====================================================================
 Acme VENDOR RATING DASHBOARD
 README
=====================================================================

Offline dashboard for vendor ratings across the four evaluation teams:
SCM, EDRC, Quality and Operations. Everything runs on your own
computer. No internet connection is required for your data and nothing
is uploaded anywhere.


---------------------------------------------------------------------
 QUICK START - WINDOWS
---------------------------------------------------------------------

  1. Unzip this folder somewhere convenient (Desktop is fine).
  2. Double-click  START_WINDOWS.bat
  3. A black window opens, then your browser opens the dashboard.
  4. The two Excel files load automatically. Nothing to click.

  KEEP THE BLACK WINDOW OPEN while you use the dashboard.
  Close it when you are finished - that shuts everything down.

  On Mac: double-click START_MAC.command instead. If nothing happens
  the first time, open Terminal in this folder and run:
      chmod +x START_MAC.command
  then try again.

  No Python on the computer? The dashboard still works:
  double-click vendor_rating.html, press "Select Files" and choose
  BOTH .xlsx files in this folder. See SETUP.txt to enable the
  automatic way.


---------------------------------------------------------------------
 WHAT IS IN THIS FOLDER
---------------------------------------------------------------------

  START_WINDOWS.bat            Start here on Windows.
  START_MAC.command            Start here on Mac.
  vendor_rating.html           The dashboard page itself.
  Vendor_Rating_Workbook.xlsx  Ratings data (SCM/EDRC/Quality/Operations).
  Vendor_Master.xlsx           Vendor contacts: code, name, factory
                               location, address and TWO contact levels
                               (first level + senior level).

  css\                         All styling, split by purpose:
    10-base.css                  Layout, tables, cards, embedded fonts.
    20-skin.css                  Visual theme + header/nav chrome (merged
                                 from two separately-loaded skin files that
                                 both redefined the same color tokens).
    30-performance.css           Rendering-speed rules for big tables.

  js\                          All code:
    vendor-theme.js              Light/dark theme switch (runs first).
    vendor\xlsx.full.min.js      SheetJS - reads the Excel files.
    vendor\chart.umd.js          Chart.js 4.4.1 - draws the charts.
    app\10 ... 90 ...            The application, in load order
                                 (65 = the Vendor Details page)
                                 (see WORKFLOW.txt for the map).
    ui-enhance.js                Small polish: animated numbers etc.
    motion.js                    Page-transition animations.
    autoload.js                  Fetches the two .xlsx automatically
                                 when served by the launcher.

  docs\                        You are here.
    README.txt                   This file.
    SETUP.txt                    Installing Python (only if asked to).
    TROUBLESHOOTING.txt          Fixes for the common problems.
    WORKFLOW.txt                 Diagrams of how everything works.
    CHANGELOG.txt                What changed in each version.

  The js\app files share one page-wide scope and MUST load in numeric
  order. If you rename or reorder them, update vendor_rating.html to
  match.


---------------------------------------------------------------------
 THE SIX PAGES
---------------------------------------------------------------------

  PORTFOLIO (overview)
      KPI cards, vendor tiers (Gold / Silver / Bronze), category
      averages and risk alerts. Most cards are clickable and open the
      records behind the number.

      Below these sits the ANALYSIS band, scoped by three controls:
      a BU dropdown (from the PO Master "BU" column), a vendor
      dropdown, and the team pills. It holds the category, project
      and item charts, the vendor location map, BU-wise Rating and
      BU-wise Performance, and Top Strengths / Weakest Parameters.
      Picking a BU narrows the vendor list to that BU. The two BU
      cards always compare every BU and highlight the picked one.

  VENDOR SCORECARD
      Rate a PO parameter by parameter, or browse "Matched Items"
      with filters for item, project, vendor and PO number. The ITEM
      column lists each half-year's item separately when a PO carries
      different items in H1 and H2.

  COMPLETENESS
      Who has finished what. Per-vendor progress with per-team
      "POs rated" columns, plus Approved / Awaiting-approval counts.
      Hover a team cell for the parameter-level detail.

  TEAM WORKLOAD
      Pick a team to see: total evaluations, rated, yet to be rated,
      approved and approval-pending; who has rated how many; the
      approver queue; and every PO with its status. Rows with no
      evaluator named are collected under "(no evaluator named)"
      so the totals always reconcile with the workbook (250 rows
      per team, 125 POs x 2 half-years).

  VENDOR FOCUS
      All vendors as cards; click one for its full page - POs,
      per-category ratings, parameter detail and contact info from
      the Vendor Master.

  VENDOR DETAILS
      The contact directory, straight from the Vendor Master. One row
      per vendor with code, name, factory location and both contact
      levels; search across every field, or filter by Complete /
      Partial / Not in Master. Click any row for the full panel -
      address, both contacts in full, and buttons through to that
      vendor's ratings or a pre-filled mail.

      Vendors that are in the rating workbook but missing from the
      Vendor Master are still listed and flagged, so the page doubles
      as a checklist of the contact data still to be collected.
      "Export" downloads the whole directory as CSV.

  The H1 / H2 / BOTH switch in the top bar is the ONLY half-year
  control. Every page follows it, including exports.


---------------------------------------------------------------------
 UPDATING THE DATA
---------------------------------------------------------------------

  Replace the two .xlsx files with new versions (same file names),
  then press "Upload new Excel" in the dashboard's top bar - or just
  restart the launcher. Manual mode: press "Select Files" again.

  The dashboard remembers imported ratings in the browser's local
  storage per half-year, so closing the tab loses nothing. Vendor
  contacts are cached the same way.

  "Email Vendor" now addresses the FIRST LEVEL contact and copies the
  SENIOR LEVEL contact automatically. An older Vendor_Master.xlsx (with
  the previous Email / Contact Person / Location columns) still loads
  without changes.


NOTE: The real 'New20Vendor_unprotected.xlsx' PO/SCM/Quality/Ops export (3000+ rows of live procurement data) is intentionally excluded from this public copy. Supply your own export with matching sheet/column names (see 'Parameters' sheet conventions) to exercise the full import pipeline.
