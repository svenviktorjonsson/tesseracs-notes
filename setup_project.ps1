# PowerShell Script for Node.js Project Setup
# Creates a basic folder structure and moves existing files.

Write-Host "Setting up Node.js project structure..."

# Define target directories
$publicDir = ".\public"
$srcDir = ".\src"

# 1. Create the 'public' directory for static assets
#    The -Force parameter ensures no error if the directory already exists.
if (-not (Test-Path -Path $publicDir -PathType Container)) {
    New-Item -ItemType Directory -Path $publicDir -Force | Out-Null
    Write-Host "- Created 'public' directory."
} else {
    Write-Host "- 'public' directory already exists."
}

# 2. Create the 'src' directory for source files (JS, CSS)
if (-not (Test-Path -Path $srcDir -PathType Container)) {
    New-Item -ItemType Directory -Path $srcDir -Force | Out-Null
    Write-Host "- Created 'src' directory."
} else {
    Write-Host "- 'src' directory already exists."
}

# 3. Move index.html to the 'public' directory
#    Check if the file exists before attempting to move it.
$htmlFile = ".\index.html"
if (Test-Path -Path $htmlFile -PathType Leaf) {
    try {
        Move-Item -Path $htmlFile -Destination $publicDir -Force -ErrorAction Stop
        Write-Host "- Moved 'index.html' to '$publicDir'."
    } catch {
        Write-Error "Error moving 'index.html': $_"
    }
} else {
    Write-Host "- 'index.html' not found in the current directory. Skipping move."
}

# 4. Move script.js to the 'src' directory
$jsFile = ".\script.js"
if (Test-Path -Path $jsFile -PathType Leaf) {
    try {
        Move-Item -Path $jsFile -Destination $srcDir -Force -ErrorAction Stop
        Write-Host "- Moved 'script.js' to '$srcDir'."
    } catch {
        Write-Error "Error moving 'script.js': $_"
    }
} else {
    Write-Host "- 'script.js' not found in the current directory. Skipping move."
}

# 5. Move style.css to the 'src' directory
$cssFile = ".\style.css"
if (Test-Path -Path $cssFile -PathType Leaf) {
    try {
        Move-Item -Path $cssFile -Destination $srcDir -Force -ErrorAction Stop
        Write-Host "- Moved 'style.css' to '$srcDir'."
    } catch {
        Write-Error "Error moving 'style.css': $_"
    }
} else {
    Write-Host "- 'style.css' not found in the current directory. Skipping move."
}

Write-Host "Project structure setup complete."
Write-Host "Current structure:"
Write-Host "├── public\"
Write-Host "│   └── index.html  (if moved)"
Write-Host "├── src\"
Write-Host "│   ├── script.js   (if moved)"
Write-Host "│   └── style.css   (if moved)"
Write-Host "└── setup_project.ps1 (this script)"

