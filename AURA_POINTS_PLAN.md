# Aura Points Calculation System - Comprehensive Plan

## 1. Overview
Aura Points represent a user's reputation and trustworthiness on ChatSphere. They're calculated dynamically based on user behavior, ratings, engagement, and violations.

---

## 2. Aura Points Formula (Recommended)

### Total Aura = (Rating Component) + (Streak Component) - (Report Penalty)

**Example Calculation:**
```
User has:
- 5 star ratings: 8 times
- 4 star ratings: 5 times
- 3 star ratings: 2 times
- 1 star ratings: 1 time
- 10-day daily streak (currently active)
- 2 reports filed against them

Rating Component = (8×50) + (5×30) + (2×15) + (1×-5) = 400 + 150 + 30 - 5 = 575
Streak Component = 10 × 5 = 50
Report Penalty = 2 × 50 = 100

Total Aura = 575 + 50 - 100 = 525 points
```

---

## 3. Rating Impact Component (40-50% of Aura)

### Star Rating Point Values:
```
5 stars  → +50 points per rating
4 stars  → +30 points per rating
3 stars  → +15 points per rating
2 stars  → +5 points per rating
1 star   → -5 points per rating (negative impact)
```

### Why This Distribution:
- **5-star**: Highest reward (+50) - encourages good behavior, recognizes quality interactions
- **4-star**: Good contribution (+30) - positive but not perfect
- **3-star**: Neutral contribution (+15) - average interaction
- **2-star**: Minimal contribution (+5) - below average but not harmful
- **1-star**: Penalty (-5) - negative behavior, reduces reputation

### Calculation Logic:
```python
rating_component = (
    (count_5_star × 50) +
    (count_4_star × 30) +
    (count_3_star × 15) +
    (count_2_star × 5) +
    (count_1_star × -5)
)
```

---

## 4. Daily Streak Component (20-30% of Aura)

### Purpose:
Rewards consistent engagement and loyalty to the platform.

### Calculation:
```
Streak Points = current_day_streak × 5 points per day
Maximum: 365 days × 5 = 1,825 points annually (if never breaks)
```

### How Streak Works:
- **Day 1**: User logs in or participates in video chat → +1 day
- **Day 2+**: Must participate again within 24 hours to continue streak
- **Breaks**: If no activity for 24 hours, streak resets to 0
- **Reset on New Streak**: Old streak is recorded in history, new one starts at Day 1

### Database Fields Needed:
```
User model:
- current_streak (days): INTEGER, default 0
- max_streak (days): INTEGER (historical high)
- last_activity_date: DATETIME (to check if streak should break)
```

### Example:
```
Day 1: user logs in  → streak = 1  → +5 points
Day 2: user chats    → streak = 2  → +10 points
Day 3: user chats    → streak = 3  → +15 points
Day 4: no activity   → streak = 0  → resets (streak breaks)
Day 5: user logs in  → streak = 1  → +5 points (new streak)
```

---

## 5. Report Impact Component (20-30% Penalty)

### Report Penalty System:
```
Each report filed against user → -50 points per report
```

### Report Types & Weights (Optional Enhancement):
```
Severity Levels:
- Mild (inappropriate behavior)     → -30 points
- Moderate (harassment)              → -50 points
- Severe (threatening/abuse)         → -100 points
- Critical (underage/illegal)        → -500 points + account review
```

### Current Simple Version:
```
aura_penalty = report_count × 50
```

### Database Requirement:
```
Report model already exists - just reference COUNT(reports WHERE reported_user=user_id)
```

---

## 6. Boundaries & Rules

### Minimum & Maximum:
- **Minimum Aura**: 0 points (cannot go negative)
- **Maximum Aura**: Unlimited (as high as user can earn)
- **Typical Range**: 0-2000 points for active users

### Aura Tiers (Optional Display):
```
0-100     → New User (🟤 Bronze)
101-300   → Trusted (🟡 Silver)
301-750   → Reliable (🟢 Gold)
751-1500  → Excellent (💎 Platinum)
1500+     → Legendary (👑 Diamond)
```

---

## 7. Recalculation Strategy

### When to Recalculate:
1. **After each rating**: Immediately update AuraPoints
2. **Daily check**: Calculate streak status daily (via celery task/cron)
3. **On report filing**: Immediately deduct penalty points
4. **User profile view**: Show cached value (recalculate if > 1 hour old)

### Database Optimization:
```
AuraPoints model:
- user (FK)
- rating_component (cached): INTEGER
- streak_component (cached): INTEGER
- report_penalty (cached): INTEGER
- total_aura (cached): INTEGER
- last_recalculated: DATETIME
- next_recalculate: DATETIME (for lazy evaluation)
```

---

## 8. Special Cases

### Case 1: User Gets Unbanned After Report
- Penalty remains applied
- User can rebuild Aura by getting positive ratings
- Reports are permanent record

### Case 2: Duplicate Ratings from Same User Pair
- Current: Prevented via `unique_together` constraint (already working)
- Aura: Won't be affected

### Case 3: User Hasn't Done Anything Yet
- Default Aura: 0 points
- Shows as "New User"

### Case 4: Idle User for 30+ Days
- Streak: Breaks after 1 day of inactivity
- Aura: Doesn't decrease, previous streak is recorded
- Can restart streak anytime by using platform

---

## 9. Implementation Tasks

### Phase 1: Data Model Updates
- [ ] Add `current_streak` field to User model
- [ ] Add `max_streak` field to User model (tracking)
- [ ] Add `last_activity_date` field to User model
- [ ] Update AuraPoints model with component caching fields
- [ ] Create migration for new fields

### Phase 2: Streak Logic
- [ ] Create `update_user_streak()` function
- [ ] Track activity when user: logs in, starts video chat, sends message
- [ ] Create daily celery task to check/break expired streaks
- [ ] Add streak display to user profile

### Phase 3: Aura Calculation
- [ ] Update `AuraPoints.recalc()` to use new formula
- [ ] Implement Rating Component calculation
- [ ] Implement Streak Component calculation
- [ ] Implement Report Penalty calculation
- [ ] Add comprehensive comments explaining formula

### Phase 4: Frontend Display
- [ ] Show Aura Points on user profile
- [ ] Show Aura Tier badge (Bronze/Silver/Gold/etc)
- [ ] Show current streak
- [ ] (Optional) Show breakdown: Rating + Streak - Penalties

### Phase 5: Testing & Deployment
- [ ] Write unit tests for each calculation component
- [ ] Test edge cases (0 points, negatives, massive streaks)
- [ ] Test recalculation performance
- [ ] Run migration on production database

---

## 10. Example Scenarios

### Scenario A: Highly Engaged Positive User
```
- 30 five-star ratings received
- 20 four-star ratings received
- 45-day active streak
- 0 reports

Rating: (30 × 50) + (20 × 30) = 1500 + 600 = 2100
Streak: 45 × 5 = 225
Reports: 0

Total Aura = 2100 + 225 - 0 = 2325 points ⭐ Legendary
```

### Scenario B: New User Getting Mixed Reviews
```
- 2 five-star ratings
- 1 four-star rating
- 1 one-star rating
- 3-day streak (new)
- 0 reports

Rating: (2 × 50) + (1 × 30) + (1 × -5) = 100 + 30 - 5 = 125
Streak: 3 × 5 = 15
Reports: 0

Total Aura = 125 + 15 - 0 = 140 points 🟡 Trusted
```

### Scenario C: Good User With Recent Issue
```
- 15 five-star ratings
- 8 four-star ratings
- 30-day streak
- 3 reports filed against them

Rating: (15 × 50) + (8 × 30) = 750 + 240 = 990
Streak: 30 × 5 = 150
Reports: 3 × 50 = 150

Total Aura = 990 + 150 - 150 = 990 points 🟢 Reliable
```

---

## 11. Configuration Parameters (Can Be Adjusted)

```python
# In settings.py or config file:
AURA_POINTS_CONFIG = {
    # Rating points
    'RATING_5_STAR': 50,
    'RATING_4_STAR': 30,
    'RATING_3_STAR': 15,
    'RATING_2_STAR': 5,
    'RATING_1_STAR': -5,

    # Streak
    'STREAK_POINTS_PER_DAY': 5,

    # Reports
    'REPORT_PENALTY': 50,

    # Tiers (for badge display)
    'TIERS': {
        'BRONZE': (0, 100),
        'SILVER': (101, 300),
        'GOLD': (301, 750),
        'PLATINUM': (751, 1500),
        'DIAMOND': (1501, float('inf')),
    }
}
```

This allows easy tweaking of values without code changes.

---

## 12. Questions for User Approval

- ✅ Rating points distribution okay? (50/30/15/5/-5)
- ✅ Streak × 5 points per day reasonable?
- ✅ Report penalty of -50 per report good?
- ✅ Should we implement aura tiers/badges?
- ✅ Should streaks reset to 0 or just stop gaining?
- ✅ Minimum bound at 0 (can't go negative) acceptable?

---

## Next Steps

1. **User Reviews Plan** → Provides feedback on values/approach
2. **Approval** → If plan looks good, proceed to implementation
3. **Implementation** → Build out all phases sequentially
4. **Testing** → Comprehensive test coverage before production
5. **Deployment** → Run migrations and monitor performance
