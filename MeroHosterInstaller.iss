[Setup]
AppName=MeroHoster
AppVersion=1.0.0
DefaultDirName={autopf}\MeroHoster
DefaultGroupName=MeroHoster
OutputDir=dist
OutputBaseFilename=MeroHoster_Setup
Compression=lzma
SolidCompression=yes
SetupIconFile=MeroHoster.ico
UninstallDisplayIcon={app}\MeroHoster.exe
PrivilegesRequired=lowest
ChangesEnvironment=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\MeroHoster\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "MeroHoster.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\MeroHoster"; Filename: "{app}\MeroHoster.exe"
Name: "{autodesktop}\MeroHoster"; Filename: "{app}\MeroHoster.exe"; Tasks: desktopicon

[Registry]
; Context menu registration for folders "Open Server in MeroHoster"
Root: HKCU; Subkey: "Software\Classes\Directory\shell\MeroHoster"; ValueType: string; ValueData: "Open Server in MeroHoster"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Directory\shell\MeroHoster"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\MeroHoster.ico"""
Root: HKCU; Subkey: "Software\Classes\Directory\shell\MeroHoster\command"; ValueType: string; ValueData: """{app}\MeroHoster.exe"" ""%1"""

Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\MeroHoster"; ValueType: string; ValueData: "Open Server in MeroHoster"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\MeroHoster"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\MeroHoster.ico"""
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\MeroHoster\command"; ValueType: string; ValueData: """{app}\MeroHoster.exe"" ""%V"""
