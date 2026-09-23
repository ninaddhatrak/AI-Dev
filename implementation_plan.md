# Implementation Plan: Scrape Real Telegram Subscriber Counts & Handle N/A Safely

This plan outlines the steps to replace the simulated/fake subscriber counts (the 38.9M reach) with actual live counts fetched from public Telegram web preview pages, while gracefully displaying `—` for channels where real data is unavailable (e.g. private channels, banned/deleted accounts).

## User Review Required

> [!IMPORTANT]
> **Data Reset**: Wiping the simulated subscriber counts will reset all channels without a public username to `NULL` (displayed as `—`). This is necessary to maintain database integrity and avoid polluting real data with fake statistics.
> **Scraping Rate-Limits**: The scraper script will query public endpoints sequentially with a safe delay (e.g. 0.5s–1s) to avoid triggering Telegram's rate-limiting/banning systems. For 1,467 channels, the first run will take around 15–20 minutes.

## Proposed Changes

### 1. Database Cleanup
We will wipe the simulated subscriber counts from the database by running a SQL update, setting all `member_count` fields to `NULL`.

### 2. Update Enrichment Logic
We will modify [enrich_data.py](AI-Dev/postgres/enrich_data.py) to prevent it from generating fake subscriber counts in future runs.

#### [MODIFY] [enrich_data.py](AI-Dev/postgres/enrich_data.py)
* Remove or comment out line 86:
  ```python
  cur.execute("UPDATE channels SET member_count = floor(random() * 50000 + 100) WHERE member_count IS NULL")
  ```

---

### 3. Fetch Real Subscriber Counts Utility
We will create a new Python script [fetch_real_subs.py](AI-Dev/postgres/fetch_real_subs.py) to scrape and update the database with real subscriber counts.

#### [NEW] [fetch_real_subs.py](AI-Dev/postgres/fetch_real_subs.py)
* Query PostgreSQL for all channels with public usernames (not null, not empty, and not starting with `pending_` or `-`).
* Sequentially fetch each channel's public web preview page (`https://t.me/s/{username}`) with chrome-like `User-Agent` headers.
* Extract the subscriber count using robust regular expressions (supporting `K`, `M`, spaces, and commas).
* Convert the count string (e.g., `10.6M` or `789K`) to a precise integer.
* Update `member_count` in the database.
* Include rate-limiting mitigation with a random delay (0.5s - 1.5s) between requests.
* Log progress clearly with success/failure statistics.

---

### 4. Backend Safety Modifications
We will modify [server.js](AI-Dev/postgres/server.js) to preserve `NULL` fields instead of coercing them to `0` when sending channel listings.

#### [MODIFY] [server.js](AI-Dev/postgres/server.js)
* **`/api/channels`** (Line 148):
  ```javascript
  - subs: c.member_count || 0,
  + subs: c.member_count !== null ? c.member_count : null,
  ```
* **`/api/channels/:channel_id`** (Line 190):
  ```javascript
  - member_count: c.member_count || 0,
  + member_count: c.member_count !== null ? c.member_count : null,
  ```
* **`/api/network`** (Line 320):
  ```javascript
  - member_count: n.member_count || 0,
  + member_count: n.member_count !== null ? n.member_count : null,
  ```

---

### 5. Frontend UI Safety Modifications
We will update [lumen-dashboard.html](AI-Dev/postgres/lumen-dashboard.html) to render `—` instead of `0` when a channel's subscriber count is not available.

#### [MODIFY] [lumen-dashboard.html](AI-Dev/postgres/lumen-dashboard.html)
* **`fmtN(n)`** (Line 1903):
  ```javascript
  function fmtN(n){
    if(n === null || n === undefined) return '—';
    if(typeof n === 'string' && (n === '' || n === 'null')) return '—';
    if(!n) return '0';
    if(n>=1e6) return (n/1e6).toFixed(1)+'M';
    if(n>=1e3) return Math.round(n/1e3)+'k';
    return String(n);
  }
  ```

---

## Verification Plan

### Automated/Manual Verification
1. **Wipe & Verify DB**: Run `UPDATE channels SET member_count = NULL;` and query the database to verify all counts are `NULL`.
2. **Backend API Check**: Query `/api/stats` and `/api/channels` before scraping and verify `totalSubscribers` is `0` and each channel's `subs` is `null`.
3. **Scraper Test**: Run `fetch_real_subs.py` on a small subset (e.g. 5–10 popular channels) and verify they are successfully updated with their real subscriber counts in PostgreSQL.
4. **Full Scrape**: Run the script to fetch all available public counts.
5. **Dashboard Visual Check**: Open the dashboard, verify that "Total Reach" reflects only the sum of successfully scraped channels, and verify that channels without usernames or unavailable metrics display `—` instead of `0` or fake randomized counts.
