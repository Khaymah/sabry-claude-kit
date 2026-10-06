param([string]$Name)
$Path = Join-Path $env:USERPROFILE ".claude\sounds\$Name"
Add-Type -AssemblyName presentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$player.Open([uri]$Path)
Start-Sleep -Milliseconds 300          # يستنى لحد ما الملف يتحمّل
$player.Play()
if ($player.NaturalDuration.HasTimeSpan) {
    Start-Sleep -Seconds $player.NaturalDuration.TimeSpan.TotalSeconds
} else {
    Start-Sleep -Seconds 5             # fallback لو الطول مش معروف
}
$player.Close()