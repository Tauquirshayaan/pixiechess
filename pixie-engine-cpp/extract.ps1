Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead("..\Stable Bot v4.4.zip")
$entry = $zip.Entries | Where-Object { $_.FullName -like "*src/board.cpp" -or $_.FullName -like "*src\board.cpp" } | Select-Object -First 1
if ($entry) {
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, ".\src\board.cpp", $true)
    Write-Host "Extracted!"
} else {
    Write-Host "Not found!"
}
$zip.Dispose()
