param(
  [string]$PngPath = "electron/assets/floraicon.png",
  [string]$IcoPath = "electron/assets/floraicon.ico"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$png = Join-Path $root $PngPath
$ico = Join-Path $root $IcoPath
$outDir = Split-Path -Parent $png

if (!(Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

Add-Type -AssemblyName System.Drawing

if (!(Test-Path $png)) {
  $size = 512
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $g.Clear([System.Drawing.Color]::Transparent)

      $stroke1 = [System.Drawing.Color]::FromArgb(255, 92, 188, 255)
      $stroke2 = [System.Drawing.Color]::FromArgb(255, 34, 154, 233)
      $strokeBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
        $stroke1,
        $stroke2,
        90
      )
      try {
        $pen = New-Object System.Drawing.Pen($strokeBrush, 18)
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

        $fillBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(190, 72, 183, 252))
        try {
          # left/right "play" triangles
          $leftTri = @(
            (New-Object System.Drawing.PointF(70, 145)),
            (New-Object System.Drawing.PointF(138, 178)),
            (New-Object System.Drawing.PointF(70, 212))
          )
          $rightTri = @(
            (New-Object System.Drawing.PointF(442, 145)),
            (New-Object System.Drawing.PointF(374, 178)),
            (New-Object System.Drawing.PointF(442, 212))
          )
          $g.FillPolygon($fillBrush, $leftTri)
          $g.FillPolygon($fillBrush, $rightTri)

          # tower roof + pillars + floors
          $g.DrawLines($pen, @(
            (New-Object System.Drawing.PointF(205, 168)),
            (New-Object System.Drawing.PointF(256, 130)),
            (New-Object System.Drawing.PointF(307, 168))
          ))
          $g.DrawLine($pen, 214, 168, 198, 315)
          $g.DrawLine($pen, 298, 168, 314, 315)
          $g.DrawLine($pen, 198, 210, 314, 210)
          $g.DrawLine($pen, 194, 254, 318, 254)

          # lower base
          $g.DrawLines($pen, @(
            (New-Object System.Drawing.PointF(205, 332)),
            (New-Object System.Drawing.PointF(307, 332)),
            (New-Object System.Drawing.PointF(320, 430)),
            (New-Object System.Drawing.PointF(192, 430)),
            (New-Object System.Drawing.PointF(205, 332))
          ))

          # ECG wave
          $g.DrawLines($pen, @(
            (New-Object System.Drawing.PointF(183, 375)),
            (New-Object System.Drawing.PointF(220, 375)),
            (New-Object System.Drawing.PointF(236, 357)),
            (New-Object System.Drawing.PointF(252, 395)),
            (New-Object System.Drawing.PointF(274, 370)),
            (New-Object System.Drawing.PointF(304, 370))
          ))
        } finally {
          $fillBrush.Dispose()
          $pen.Dispose()
        }
      } finally {
        $strokeBrush.Dispose()
      }
    } finally {
      $g.Dispose()
    }
    $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bmp.Dispose()
  }
  Write-Host "Created PNG:" $png
}

$bitmap = New-Object System.Drawing.Bitmap($png)
try {
  $resized = New-Object System.Drawing.Bitmap($bitmap, (New-Object System.Drawing.Size(256, 256)))
  try {
    $icon = [System.Drawing.Icon]::FromHandle($resized.GetHicon())
    try {
      $icoDir = Split-Path -Parent $ico
      if (!(Test-Path $icoDir)) {
        New-Item -ItemType Directory -Path $icoDir -Force | Out-Null
      }
      $fs = [System.IO.File]::Open($ico, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
      try {
        $icon.Save($fs)
      } finally {
        $fs.Dispose()
      }
    } finally {
      $icon.Dispose()
    }
  } finally {
    $resized.Dispose()
  }
} finally {
  $bitmap.Dispose()
}

Write-Host "Created ICO:" $ico
