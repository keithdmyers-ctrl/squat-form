# Contributing to Squat Form Analyzer

## Development Setup

### Frontend (TypeScript + Vite)

```bash
cd frontend
npm install
npm run dev          # dev server at http://localhost:5173
```

### Backend (Python + FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

## Running Tests

### Backend tests (pytest)

```bash
pip install pytest httpx
pytest tests/ -v
```

### Frontend type checking and tests

```bash
cd frontend
npx tsc --noEmit     # type check
npx vitest run       # unit tests
npx vite build       # production build
```

## Code Style

- **Frontend**: TypeScript (strict mode). Follow existing patterns in `frontend/src/`.
- **Backend**: Python 3.10+. Follow existing patterns in `backend/squat_form/`.
- No specific linter config is enforced. Match the style of surrounding code.

## Branch Workflow

1. Create a feature branch from `main`: `git checkout -b feature/my-change`
2. Make your changes and test them.
3. Open a pull request against `main`.
4. Keep PRs focused -- one feature or fix per PR.

## Dual-Stack Architecture

The frontend and backend implement the **same analysis algorithms** independently:

- Frontend: TypeScript modules in `frontend/src/` (runs entirely in-browser)
- Backend: Python modules in `backend/squat_form/` (server-side processing)

**If you change analysis logic (scoring, phase detection, issue detection, calibration, etc.), you must update both stacks.** The relevant file pairs are:

| Frontend               | Backend                      |
|------------------------|------------------------------|
| `angles.ts`            | `angles.py`                  |
| `phases.ts`            | `phases.py`                  |
| `scorer.ts`            | `scorer.py`                  |
| `calibration.ts`       | `calibration.py`             |
| `issues.ts`            | `feedback.py`                |
| `mobility.ts`          | `mobility.py`                |
| `analyzer.ts`          | `analyzer.py`                |
| `competition.ts`       | (integrated in `analyzer.py`)|
| `cues.ts`              | `feedback/cues.py`           |

## Reporting Issues

Open a GitHub issue with:
- Steps to reproduce
- Expected vs. actual behavior
- Browser/OS if it is a frontend issue
