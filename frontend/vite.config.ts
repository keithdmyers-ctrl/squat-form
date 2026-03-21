import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split analysis core (angles, phases, scorer, issues, cues)
          'analysis': [
            './src/angles.ts',
            './src/phases.ts',
            './src/scorer.ts',
            './src/issues.ts',
            './src/cues.ts',
            './src/calibration.ts',
            './src/smoothing.ts',
            './src/phase-detector.ts',
          ],
          // Split competition/meet features
          'competition': [
            './src/competition.ts',
            './src/meet-prep.ts',
            './src/meet-prep-plan.ts',
            './src/rankings.ts',
            './src/strength-standards.ts',
          ],
          // Split export/utility features
          'tools': [
            './src/multi-angle.ts',
            './src/snapshot.ts',
            './src/gif-export.ts',
            './src/video-export.ts',
            './src/csv-export.ts',
            './src/share.ts',
            './src/video-annotation.ts',
            './src/bar-path.ts',
          ],
          // Split new feature modules
          'features': [
            './src/ml-personalization.ts',
            './src/bluetooth-vbt.ts',
            './src/health-sync.ts',
            './src/data-backup.ts',
            './src/progression-charts.ts',
            './src/workout-flexibility.ts',
            './src/form-programming-bridge.ts',
            './src/warmup-calculator.ts',
            './src/muscle-map.ts',
          ],
          // Split safety/screening
          'safety': [
            './src/safety-screening.ts',
            './src/mobility.ts',
          ],
        },
      },
    },
  },
  server: {
    open: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
