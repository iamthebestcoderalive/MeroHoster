[Setup]
AppName=MeroClient
AppVersion=1.0.0
DefaultDirName={autopf}\MeroClient
DefaultGroupName=MeroClient
OutputDir=dist
OutputBaseFilename=MeroClient_Setup
Compression=lzma
SolidCompression=yes
SetupIconFile=MeroClient.ico
UninstallDisplayIcon={app}\MeroClient.exe
PrivilegesRequired=lowest
ChangesEnvironment=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\MeroClient\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\MeroClient"; Filename: "{app}\MeroClient.exe"
Name: "{autodesktop}\MeroClient"; Filename: "{app}\MeroClient.exe"; Tasks: desktopicon
