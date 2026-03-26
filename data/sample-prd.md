# PRD: Q3 Dashboard Revamp

**Status:** In Review
**Owner:** Alice Chen
**Last Updated:** 2026-03-01
**Version:** 1.2

---

## 1. Overview

The current analytics dashboard has low engagement (avg session time: 2.1 min) and poor mobile usability scores (NPS: 28). This PRD defines the redesign effort for Q3 to improve usability, increase data density, and enable personalization.

## 2. Problem Statement

- Users spend excessive time searching for key metrics across disconnected views
- The dashboard is not responsive — mobile users (34% of DAU) see a broken layout
- There is no way to save custom views or filter presets
- Date-range filtering is not intuitive; users frequently contact support for help

## 3. Goals

1. Increase average session time on the dashboard from 2.1 min → 4 min
2. Raise mobile NPS from 28 → 50 by end of Q3
3. Reduce "how do I filter by date?" support tickets by 60%
4. Enable at least 3 personalization actions per user per week

## 4. Non-Goals

- This project does NOT include a new data pipeline or new data sources
- Real-time streaming data is out of scope (planned for Q4)
- We are NOT redesigning the settings or billing pages

## 5. User Stories

| ID | As a… | I want to… | So that… |
|----|--------|------------|----------|
| US-1 | Analyst | select a custom date range from a calendar picker | I can compare any two periods easily |
| US-2 | Manager | save a filtered view as a "preset" | I can open my personalized view in one click |
| US-3 | Mobile user | see a fully responsive dashboard | I can monitor KPIs on my phone |
| US-4 | Power user | drag and resize dashboard widgets | I can arrange metrics by personal priority |

## 6. Functional Requirements

### 6.1 Date Range Picker
- Must support: Today, Last 7 days, Last 30 days, Last 90 days, Custom range
- Custom range picker must allow selecting start and end dates from a calendar UI
- Range selection must update all widgets simultaneously with no full-page reload
- Maximum selectable range: 365 days

### 6.2 Saved Presets
- Users can save up to 10 named filter presets (date range + active filters)
- Presets are stored per-user and persist across sessions
- Presets can be renamed and deleted

### 6.3 Responsive Layout
- Dashboard must be fully usable on viewports ≥ 375px wide
- Mobile layout stacks widgets vertically in a single column
- Widgets must show a condensed view (key metric + mini-chart) on mobile

### 6.4 Widget Customization
- Users can reorder widgets via drag-and-drop on desktop
- Users can hide/show widgets from a widget picker panel
- Widget layout is persisted per-user

## 7. Non-Functional Requirements

- Page load time (P95): < 2 seconds on a 10 Mbps connection
- Dashboard must remain functional with up to 50 concurrent widgets
- All interactions must be accessible (WCAG 2.1 AA)

## 8. Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Avg session time | 2.1 min | 4 min | Mixpanel |
| Mobile NPS | 28 | 50 | Quarterly survey |
| Support tickets (date filter) | 120/mo | < 50/mo | Zendesk |
| Preset saves per user | 0 | ≥ 3/week | Internal analytics |

## 9. Open Questions

- [ ] Should presets be shareable across team members? (Decision needed by 2026-03-15)
- [ ] What is the migration strategy for users' current custom widget configs?
- [ ] Do we need a "reset to default" option for widget layout?

## 10. Dependencies

- Design: Figma mockups due 2026-03-10
- Backend: Filter preset API endpoints (BE team, est. 3 days)
- Data: Confirm date-range query performance with Data Eng (spike needed)
