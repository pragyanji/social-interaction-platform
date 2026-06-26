# ChatSphere: Aura Points Calculation System

Aura Points represent a user's reputation and trustworthiness on ChatSphere. They are calculated dynamically based on real-time user behavior, ratings, active engagement streaks, and content warnings/reports.

---

## 1. The Aura Points Formula

A user's total Aura points are calculated as follows (with a minimum boundary of `0`):

$$\text{Total Aura} = \max\left(0, \text{Rating Component} + \text{Streak Component} - (\text{Manual Report Penalty} + \text{Warning Penalty})\right)$$

---

## 2. Component Details

### A. Rating Component (Earned)
Calculated from the total ratings received from other users:
*   **5-star rating (★★★★★):** `+50` points
*   **4-star rating (★★★★☆):** `+30` points
*   **3-star rating (★★★☆☆):** `+15` points
*   **2-star rating (★★☆☆☆):** `+5` points
*   **1-star rating (★☆☆☆☆):** `-5` points

### B. Daily Streak Component (Earned)
Rewards consistent daily engagement. A user must participate in chat activity at least once every 24 hours to keep their streak active:
*   `+5` points per active day in the current streak.
*   *Example:* A 10-day streak awards `+50` points.
*   If the user is inactive for more than 24 hours, the current streak resets to `0`.

### C. Manual Report Penalty (Deducted)
*   **`-50` points** per user-submitted manual report filed against the user.

### D. Warning Penalty (Deducted)
*   **`-150` points** per automated content/NSFW safety warning issued to the user by the moderation system.

---

## 3. Boundaries & Rules
*   **Minimum Score:** `0` points (Aura points can never go negative).
*   **Maximum Score:** Unlimited.

---

## 4. Recalculation Strategy
The system updates Aura Points dynamically:
1.  **Immediate:** Recalculated after receiving any rating.
2.  **Immediate:** Recalculated whenever a manual user report is submitted.
3.  **Immediate:** Recalculated whenever a content moderation warning is issued.
4.  **Daily:** Recalculated when daily streak checks are evaluated.
