# Adperastra Step 00 - environment check (run: .\build\check-environment.ps1)
Write-Host "Adperastra - environment check"
Write-Host "------------------------------"
function Show-Tool($name, $cmd) {
  $c = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($c) { Write-Host ("OK      {0}: {1}" -f $name, (& $cmd --version 2>&1 | Select-Object -First 1)) }
  elseif ($cmd -eq "gh" -and (Test-Path "C:\Program Files\GitHub CLI\gh.exe")) {
    Write-Host ("OK      gh: {0} (installed; reopen PowerShell to use gh directly)" -f (& "C:\Program Files\GitHub CLI\gh.exe" --version | Select-Object -First 1))
  } else { Write-Host ("MISSING {0} (command: {1})" -f $name, $cmd) }
}
Show-Tool "Git" "git"
Show-Tool "Rust" "rustc"
Show-Tool "Cargo" "cargo"
Show-Tool "Node.js" "node"
Show-Tool "GitHub CLI" "gh"
Write-Host ""
Write-Host "Repository:"
git --no-pager log --oneline -3
git status --short --branch | Select-Object -First 5
Write-Host ""
Write-Host "Step 00 documents: ARCHITECTURE.md, docs/design-inventory.md, docs/test-and-speed-plan.md, docs/dependency-and-license-table.md, docs/benchmarks/MACHINE.md"
