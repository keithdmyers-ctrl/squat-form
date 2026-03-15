/**
 * File upload handling, drag-and-drop, front video input, and validation warnings.
 * Extracted from main.ts for better module boundaries.
 */

// ─── DOM Elements ───

const videoInput = document.getElementById('video-input') as HTMLInputElement;
const analyzeBtn = document.getElementById('analyze-btn') as HTMLButtonElement;
const frontVideoInput = document.getElementById('front-video-input') as HTMLInputElement | null;
const frontDropLabel = document.getElementById('front-drop-label') as HTMLElement | null;
const fileDropZone = document.getElementById('file-drop-zone');
const dropLabel = document.getElementById('drop-label');

// ─── Module State ───

let selectedFile: File | null = null;
let selectedFrontFile: File | null = null;
let quickStartPending = false;

/** Get the currently selected main video file. */
export function getSelectedFile(): File | null {
  return selectedFile;
}

/** Get the currently selected front-view video file. */
export function getSelectedFrontFile(): File | null {
  return selectedFrontFile;
}

/** Set the selected file directly (e.g. from example video). */
export function setSelectedFile(file: File | null): void {
  selectedFile = file;
}

// ─── Upload Mode Initialization ───

/**
 * Initialize all upload-related event listeners: drop zone, file input, front video input.
 * @param onFileSelected Called when a file is selected and ready for analysis (auto-start from quick start).
 */
export function initUploadMode(onFileSelected: (file: File) => void): void {
  // File Drop Zone Enhancement
  if (fileDropZone) {
    fileDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      fileDropZone.classList.add('drag-over');
    });
    fileDropZone.addEventListener('dragleave', () => {
      fileDropZone.classList.remove('drag-over');
    });
    fileDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      fileDropZone.classList.remove('drag-over');
      const files = (e as DragEvent).dataTransfer?.files;
      if (files && files.length > 0 && files[0].type.startsWith('video/')) {
        // Transfer the dropped file to the input
        const dt = new DataTransfer();
        dt.items.add(files[0]);
        videoInput.files = dt.files;
        videoInput.dispatchEvent(new Event('change'));
      }
    });
  }

  // Main video input change handler
  videoInput.addEventListener('change', () => {
    // Reset Quick Start button on file selection
    const quickStartBtn = document.getElementById('quick-start-btn');
    if (quickStartBtn) {
      quickStartBtn.textContent = 'Check My Form';
      (quickStartBtn as HTMLButtonElement).disabled = false;
    }

    const files = videoInput.files;
    if (files && files.length > 0) {
      selectedFile = files[0];
      analyzeBtn.disabled = false;
      analyzeBtn.removeAttribute('title');

      // Update drop zone to show selected file name
      if (dropLabel) {
        dropLabel.textContent = selectedFile.name;
        dropLabel.classList.add('file-name');
      }

      // If Quick Start triggered this, show filename confirmation and auto-start
      if (quickStartPending) {
        quickStartPending = false;
        if (quickStartBtn) {
          quickStartBtn.textContent = `Analyzing: ${selectedFile.name}`;
          (quickStartBtn as HTMLButtonElement).disabled = true;
        }
        onFileSelected(selectedFile);
      }
    } else {
      selectedFile = null;
      analyzeBtn.disabled = true;
      analyzeBtn.title = 'Select a video file first';
      // Reset drop zone label
      if (dropLabel) {
        dropLabel.textContent = 'Tap to select or drag a video here';
        dropLabel.classList.remove('file-name');
      }
    }
  });

  // Front Video Input (multi-angle)
  if (frontVideoInput) {
    frontVideoInput.addEventListener('change', () => {
      const files = frontVideoInput.files;
      if (files && files.length > 0) {
        selectedFrontFile = files[0];
        if (frontDropLabel) {
          frontDropLabel.textContent = selectedFrontFile.name;
          frontDropLabel.style.color = 'var(--accent)';
          frontDropLabel.style.fontWeight = '600';
        }
      } else {
        selectedFrontFile = null;
        if (frontDropLabel) {
          frontDropLabel.textContent = 'Add a front view for better knee/symmetry analysis';
          frontDropLabel.style.color = '';
          frontDropLabel.style.fontWeight = '';
        }
      }
    });
  }

  // Analyze button click
  analyzeBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    onFileSelected(selectedFile);
  });
}

/** Set the quick start pending flag (used by initQuickStart in main.ts). */
export function setQuickStartPending(value: boolean): void {
  quickStartPending = value;
}
