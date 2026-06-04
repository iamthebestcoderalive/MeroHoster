[Setup]
AppName=MeroHoster
AppVersion=1.0.0
DefaultDirName={autopf}\MeroHoster
DefaultGroupName=MeroHoster
OutputDir=dist
OutputBaseFilename=MeroHoster_Setup
Compression=lzma2/max
SolidCompression=yes
SetupIconFile=MeroHoster.ico
UninstallDisplayIcon={app}\MeroHoster.ico
PrivilegesRequired=lowest
ChangesEnvironment=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
DisableDirPage=no

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "bundled_python\*"; DestDir: "{app}\python"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*\__pycache__\*,__pycache__\*,*.pyc,*.pyo"
Source: "backend\*"; DestDir: "{app}\backend"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*\__pycache__\*,__pycache__\*,*\.webview_storage\*,.webview_storage\*,*.pyc,*.pyo"
Source: "MeroHoster.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\MeroHoster"; Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\backend\mero_host.py"""; IconFilename: "{app}\MeroHoster.ico"
Name: "{autodesktop}\MeroHoster"; Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\backend\mero_host.py"""; IconFilename: "{app}\MeroHoster.ico"; Tasks: desktopicon

[Registry]
; Context menu registration for folders "Open Server in MeroHoster"
Root: HKCU; Subkey: "Software\Classes\Directory\shell\MeroHoster"; ValueType: string; ValueData: "Open Server in MeroHoster"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Directory\shell\MeroHoster"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\MeroHoster.ico"""
Root: HKCU; Subkey: "Software\Classes\Directory\shell\MeroHoster\command"; ValueType: string; ValueData: """{app}\python\pythonw.exe"" ""{app}\backend\mero_host.py"" ""%1"""

Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\MeroHoster"; ValueType: string; ValueData: "Open Server in MeroHoster"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\MeroHoster"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\MeroHoster.ico"""
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\MeroHoster\command"; ValueType: string; ValueData: """{app}\python\pythonw.exe"" ""{app}\backend\mero_host.py"" ""%V"""
