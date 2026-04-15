// A global variable to store the results for the PDF report
let analysisResults = {};

// ===== DARK/LIGHT MODE LOGIC =====
document.addEventListener('DOMContentLoaded', (event) => {
    const toggleButton = document.querySelector(".theme-toggle"); // Get the button element

    // **1. Apply theme on initial page load**
    if (localStorage.getItem("theme") === "dark") {
        document.body.classList.add("dark");
    }

    // **2. Add click listener to the toggle button**
    if (toggleButton) {
        toggleButton.addEventListener("click", () => {
            // Toggle the class on the body
            document.body.classList.toggle("dark");
            
            // Save the new preference to localStorage
            localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
        });
    }

    // *** Keep this part if you still use localStorage for stats on profile page ***
    // (Although the profile page now gets stats from Flask)
    // If you don't need this, you can remove it.
    if (!localStorage.getItem("totalAnalyses")) {
        localStorage.setItem("totalAnalyses", 0);
        localStorage.setItem("successfulExtractions", 0);
        localStorage.setItem("pdfReports", 0);
     }
    // *** End of optional stats initialization ***

}); // End of DOMContentLoaded listener

// ===== IMAGE PREVIEW =====
function previewImage(event) {
  const imagePreview = document.getElementById("imagePreview");
  const file = event.target.files[0];

  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      imagePreview.src = e.target.result;
      imagePreview.style.display = "block"; // Make sure it's visible
    };
    reader.readAsDataURL(file);
  }
}

// ===== REAL ANALYSIS FUNCTION (Replaces simulateAnalysis) =====
async function analyzeImage() {
  const fileInput = document.getElementById("fileInput");
  const resultContainer = document.getElementById("result");

  if (fileInput.files.length === 0) {
    alert("⚠️ Please choose an image first!");
    return;
  }

  // 1. Show loading message
  resultContainer.innerHTML = "<h3>🧠 Analyzing... Please wait. This may take a moment.</h3>";
  analysisResults = {}; // Clear previous results

  // 2. Create FormData and send the file to the Python server
  const formData = new FormData();
  formData.append("fileInput", fileInput.files[0]);

  try {
    const response = await fetch("/analyze", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.statusText}`);
    }

    const results = await response.json();
    analysisResults = results; // Save results globally for PDF

    // 3. Display the results on the page
    displayResults(results);

    // 4. Update the stats
    updateStats(results);

  } catch (error) {
    console.error("Error:", error);
    resultContainer.innerHTML = `<h3 style="color: red;">❌ Analysis failed. Error: ${error.message}</h3>`;
  }
}

// ===== DISPLAY RESULTS ON PAGE (MINIMAL) =====
function displayResults(results) {
  const resultContainer = document.getElementById("result");
  resultContainer.innerHTML = ""; // Clear loading message

  // 1. Add Prediction ONLY
  let predictionColor = results.prediction.includes("STEGO") ? "red" : "green";
  resultContainer.innerHTML += `
    <div class="result-section">
      <h2>Detection Result</h2>
      <p style="color: ${predictionColor}; font-weight: bold; font-size: 1.2em;">
        ${results.prediction}
      </p>
      <p>(Model Score: ${results.score})</p>
    </div>
  `;
  
  // We no longer display the message or LSB maps on the webpage.
  // They will only be in the PDF.
}  

// ===== UPDATE STATS IN LOCALSTORAGE =====
function updateStats(results) {
  let total = parseInt(localStorage.getItem("totalAnalyses") || "0") + 1;
  let successful = parseInt(localStorage.getItem("successfulExtractions") || "0");
  
  if (results.prediction.includes("STEGO")) {
    successful++;
  }
  
  localStorage.setItem("totalAnalyses", total);
  localStorage.setItem("successfulExtractions", successful);
  
  // Note: Your "multiLayerAnalyses" seemed random, so I've left it out,
  // but you can add it back here if it's a real metric.
}

// ===== GENERATE PDF REPORT (NOW WITH MULTI-PAGE SUPPORT) =====
async function generatePDF() {
  const imageElement = document.getElementById("imagePreview");

  // Check if an analysis has been run
  if (!analysisResults.prediction) {
    alert("⚠️ Please run an analysis before generating a report.");
    return;
  }

  // Make sure jsPDF is loaded
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("❌ jsPDF library not loaded. Check your HTML <script> tag.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // --- Page Layout Variables ---
  const pageMargin = 20;
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageWidth = pdf.internal.pageSize.getWidth();
  // The usable area for text, preventing overflow
  const maxTextWidth = pageWidth - (pageMargin * 2);
  // The "bottom" of the page we shouldn't cross
  const pageBottom = pageHeight - pageMargin;
  
  // This is our "cursor" that we'll move down the page
  let yPos = pageMargin;

  // --- Helper Function for Page Breaks ---
  // We'll call this before adding any new element
  function checkPageBreak(elementHeight) {
    // Check if adding the element would go off the page
    if (yPos + elementHeight > pageBottom) {
      pdf.addPage();
      yPos = pageMargin; // Reset cursor to the top of the new page
    }
  }
  
  // --- 1. Header ---
  let elementHeight = 15; // Approx. height for the title
  checkPageBreak(elementHeight);
  pdf.setFontSize(20);
  pdf.text("CyberStego Analysis Report", pageMargin, yPos);
  yPos += elementHeight; // Move the cursor down

  // --- 2. Metadata ---
  elementHeight = 25; // Approx. height for the 3 metadata lines
  checkPageBreak(elementHeight);
  pdf.setFontSize(12);
  pdf.text(`Date: ${new Date().toLocaleString()}`, pageMargin, yPos);
  yPos += 10;
  pdf.text(`Result: ${analysisResults.prediction}`, pageMargin, yPos);
  yPos += 5;
  pdf.text(`Model Score: ${analysisResults.score}`, pageMargin, yPos);
  yPos += 15;

  // --- 3. Extracted Message (with text wrap) ---
  elementHeight = 8; // Height for the title
  checkPageBreak(elementHeight);
  pdf.setFontSize(14);
  pdf.text("Extracted Message:", pageMargin, yPos);
  yPos += elementHeight;
  
  pdf.setFontSize(10);
  if (analysisResults.message) {
    const messageLines = pdf.splitTextToSize(analysisResults.message, maxTextWidth);
    elementHeight = messageLines.length * 5; // 5mm per line
    
    checkPageBreak(elementHeight); // Check if the *whole message block* fits
    
    pdf.text(messageLines, pageMargin, yPos);
    yPos += elementHeight + 10; // Add padding after the message
  } else {
    elementHeight = 5;
    checkPageBreak(elementHeight);
    pdf.setFontSize(12);
    pdf.text("None", pageMargin, yPos);
    yPos += 15;
  }

  // --- 4. Image Analysis Section ---
  // This section is tall: ~80mm for the main image + 3x50mm for LSB maps
  // We'll check for the tallest column (the LSB maps stack)
  elementHeight = 10 + 7 + 50 + 7 + 50 + 7 + 50; // Title + 3 maps + padding
  checkPageBreak(elementHeight + 20); // Add 20mm extra buffer
  
  pdf.setFontSize(14);
  pdf.text("Image Analysis:", pageMargin, yPos);
  yPos += 10;
  
  let imageX = pageMargin;
  let mapX = (pageWidth / 2) + 10;
  let imageY = yPos;
  let mapY = yPos;

  // 5. Analyzed Image (on the left)
  if (imageElement && imageElement.src) {
    try {
      pdf.setFontSize(12);
      pdf.text("Analyzed Image:", imageX, imageY);
      imageY += 7;
      pdf.addImage(imageElement.src, "PNG", imageX, imageY, 80, 80);
    } catch (err) {
      console.error("Analyzed Image could not be added to PDF:", err);
      pdf.text("Error loading image.", imageX, imageY);
    }
  }

  // 6. LSB Maps (stacked on the right)
  if (analysisResults.lsb_maps) {
    pdf.setFontSize(12);
    pdf.text("LSB Planes (R, G, B):", mapX, mapY);
    mapY += 7;
    
    try {
      pdf.addImage(analysisResults.lsb_maps.r, "PNG", mapX, mapY, 50, 50);
      mapY += 55; // Move cursor down
      
      checkPageBreak(55); // Check for page break before next image
      pdf.addImage(analysisResults.lsb_maps.g, "PNG", mapX, mapY, 50, 50);
      mapY += 55; // Move cursor down
      
      checkPageBreak(55); // Check for page break before next image
      pdf.addImage(analysisResults.lsb_maps.b, "PNG", mapX, mapY, 50, 50);
    } catch (e) {
      console.error("LSB map error:", e);
      pdf.text("Error loading LSB maps.", mapX, mapY);
    }
  }

  // --- NEW: Tell server to increment PDF count ---
  try {
      await fetch('/increment_pdf_count', { method: 'POST' });
  } catch (err) {
      console.error("Failed to increment PDF count on server:", err);
      // Non-critical error, PDF will still save
  }
  // --- END NEW BLOCK ---

  // 7. Save the file
  pdf.save(`CyberStego_Report_${Date.now()}.pdf`);

  // --- REMOVE local storage update ---
  // let pdfCount = parseInt(localStorage.getItem("pdfReports") || 0);
  // localStorage.setItem("pdfReports", pdfCount + 1);
}

// ===== LOAD STATS ON PROFILE PAGE =====
function updateProfileStats() {
  const total = localStorage.getItem("totalAnalyses") || 0;
  const successful = localStorage.getItem("successfulExtractions") || 0;
  const pdfReports = localStorage.getItem("pdfReports") || 0;
  // const multilayer = localStorage.getItem("multilayerAnalyses") || 0; // <-- REMOVE or comment out

  const totalElem = document.getElementById("totalAnalyses");
  const successElem = document.getElementById("successfulExtractions");
  const pdfElem = document.getElementById("pdfReports");
  // const multiElem = document.getElementById("multilayerAnalyses"); // <-- REMOVE or comment out

  if (totalElem) totalElem.textContent = total;
  if (successElem) successElem.textContent = `${successful} (${Math.round((successful / Math.max(total, 1)) * 100)}%)`;
  if (pdfElem) pdfElem.textContent = pdfReports;
  // if (multiElem) multiElem.textContent = multilayer; // <-- REMOVE or comment out
}

// Initialize stats if they don't exist
document.addEventListener("DOMContentLoaded", () => {
  if (!localStorage.getItem("totalAnalyses")) {
    localStorage.setItem("totalAnalyses", 0);
    localStorage.setItem("successfulExtractions", 0);
    // localStorage.setItem("multilayerAnalyses", 0); // <-- REMOVE or comment out
    localStorage.setItem("pdfReports", 0);
  }

  // Update stats if we are on the profile page
  if (window.location.pathname.includes("profile.html")) {
    updateProfileStats();
  }
});