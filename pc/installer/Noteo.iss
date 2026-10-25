; =====================================================================
;  Noteo : installateur Inno Setup 6
;
;  Contenu :
;    - choix de l'emplacement d'installation (page standard)
;    - diaporama des captures d'écran de l'application
;    - choix du type de compte (aucun / local / en ligne : créer ou se connecter)
;    - raccourcis Bureau et menu Démarrer au choix
;    - 14 fonds d'écran livrés avec l'application
;
;  Le type de compte est écrit dans "noteo-setup.json" (à côté de Noteo.exe) :
;  Noteo le lit au premier lancement et ouvre directement l'écran voulu.
;  Aucun mot de passe n'est saisi dans l'installateur.
;
;  Compiler :  build-installer.bat   (ou ouvrir ce fichier dans Inno Setup puis F9)
;  IMPORTANT : ce fichier doit rester enregistré en UTF-8 AVEC BOM (accents).
; =====================================================================

#define AppName "Noteo"
#define AppExe "Noteo.exe"
#define AppPublisher "Kaïto"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
; Dossier produit par "npm run pack" (electron-builder --dir)
#define SourceDir "..\dist\win-unpacked"

; Thème sombre : disponible à partir d'Inno Setup 6.6. Avec une version plus ancienne,
; l'installateur reste en thème clair au lieu de refuser de se compiler.
#if Ver >= 0x06060000
  #define WizStyle "modern dark"
#else
  #define WizStyle "modern"
#endif

[Setup]
; GUID unique de l'application : NE JAMAIS LE CHANGER (les mises à jour s'en servent)
AppId={{7D2C9A41-5B3E-4C68-9F10-A3E4B8D6C512}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=no
; Installation pour l'utilisateur courant par défaut (pas besoin d'être administrateur)
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir=Output
OutputBaseFilename=Noteo-Installateur-{#AppVersion}
SetupIconFile=..\build\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2
SolidCompression=yes
WizardStyle={#WizStyle}
WizardSizePercent=125,125
; Images 32 bits avec transparence : elles prennent la couleur du thème (clair ou sombre)
WizardImageAlphaFormat=defined
WizardImageFile=assets\wizard-164.bmp,assets\wizard-205.bmp,assets\wizard-246.bmp,assets\wizard-287.bmp,assets\wizard-328.bmp
WizardSmallImageFile=assets\small-58.bmp,assets\small-77.bmp,assets\small-97.bmp,assets\small-116.bmp,assets\small-124.bmp
CloseApplications=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Messages]
french.FinishedLabel=[name] est installé.%n%nAstuce : pour l'épingler à la barre des tâches, lance Noteo, fais un clic droit sur son icône dans la barre des tâches, puis choisis « Épingler à la barre des tâches ».
french.FinishedLabelNoIcons=[name] est installé.%n%nAstuce : pour l'épingler à la barre des tâches, lance Noteo, fais un clic droit sur son icône dans la barre des tâches, puis choisis « Épingler à la barre des tâches ».

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Où veux-tu retrouver Noteo ?"
Name: "startmenuicon"; Description: "Ajouter Noteo au menu Démarrer"; GroupDescription: "Où veux-tu retrouver Noteo ?"

[Files]
; L'application
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Fonds d'écran par défaut : Noteo les recopie dans son dossier "fonds" au premier lancement
Source: "..\fonds-defaut\*"; DestDir: "{app}\resources\fonds-defaut"; Flags: ignoreversion recursesubdirs createallsubdirs
; Captures du diaporama (uniquement utilisées par l'assistant, jamais copiées sur le disque)
Source: "assets\slide1.bmp"; Flags: dontcopy
Source: "assets\slide2.bmp"; Flags: dontcopy
Source: "assets\slide3.bmp"; Flags: dontcopy
Source: "assets\slide4.bmp"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: startmenuicon
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Lancer Noteo"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\noteo-setup.json"
Type: files; Name: "{app}\noteo-setup.json.done"

[Code]
const
  SlideCount = 4;
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{7D2C9A41-5B3E-4C68-9F10-A3E4B8D6C512}_is1';

var
  SlidesPage: TWizardPage;
  SlideImage: TBitmapImage;
  SlideTitle: TNewStaticText;
  SlideText: TNewStaticText;
  SlidePrev: TNewButton;
  SlideNext: TNewButton;
  SlideIndex: Integer;
  SlideExtracted: array[0..3] of Boolean;
  AccountPage: TInputOptionWizardPage;
  ReadySummary: TNewStaticText;
  ReadySummaryCreated: Boolean;
  { Vrai si Noteo était DÉJÀ installé avant de lancer cet assistant. À mémoriser au démarrage :
    Inno écrit sa clé de désinstallation avant l'étape ssPostInstall, donc la tester plus tard
    répondrait toujours "oui" (c'était le bug : le choix du compte n'était jamais enregistré). }
  WasInstalled: Boolean;

{ ---------- Mise à jour d'une installation existante ? ---------- }

function IsUpgrade(): Boolean;
var
  S: String;
begin
  Result := RegQueryStringValue(HKCU, UninstallKey, 'UninstallString', S)
         or RegQueryStringValue(HKLM, UninstallKey, 'UninstallString', S);
end;

{ ---------- Diaporama ---------- }

function SlideFile(I: Integer): String;
begin
  Result := 'slide' + IntToStr(I + 1) + '.bmp';
end;

function SlideTitleOf(I: Integer): String;
begin
  case I of
    0: Result := 'Tes notes, classées comme tu veux';
    1: Result := 'Un éditeur complet';
    2: Result := 'Ton espace compte';
    3: Result := 'Un dossier verrouillé';
  else
    Result := '';
  end;
end;

function SlideTextOf(I: Integer): String;
begin
  case I of
    0: Result := 'Dossiers et sous-dossiers, favoris, recherche et fonds d''écran au choix.';
    1: Result := 'Mise en forme, tableaux, images recadrables, emojis, import de PDF, verrouillage par mot de passe.';
    2: Result := 'Sans compte, compte local ou compte en ligne synchronisé et chiffré, avec code PIN à l''ouverture.';
    3: Result := 'Protège tes notes sensibles avec un code dédié, séparé du reste de ton espace.';
  else
    Result := '';
  end;
end;

procedure ShowSlide(I: Integer);
begin
  SlideIndex := I;
  if not SlideExtracted[I] then
  begin
    ExtractTemporaryFile(SlideFile(I));
    SlideExtracted[I] := True;
  end;
  SlideImage.Bitmap.LoadFromFile(ExpandConstant('{tmp}\') + SlideFile(I));
  SlideTitle.Caption := IntToStr(I + 1) + ' / ' + IntToStr(SlideCount) + '  -  ' + SlideTitleOf(I);
  SlideText.Caption := SlideTextOf(I);
  SlidePrev.Enabled := I > 0;
  SlideNext.Enabled := I < SlideCount - 1;
end;

procedure SlideNavClick(Sender: TObject);
begin
  if Sender = SlideNext then
    ShowSlide(SlideIndex + 1)
  else
    ShowSlide(SlideIndex - 1);
end;

procedure CreateSlidesPage;
var
  W, ImgH, BelowTop: Integer;
begin
  SlidesPage := CreateCustomPage(wpWelcome, 'Découvre Noteo', 'Un aperçu de l''application que tu vas installer.');

  W := SlidesPage.SurfaceWidth;
  ImgH := (W * 9) div 16;
  if ImgH > SlidesPage.SurfaceHeight - ScaleY(64) then
    ImgH := SlidesPage.SurfaceHeight - ScaleY(64);

  SlideImage := TBitmapImage.Create(SlidesPage);
  SlideImage.Parent := SlidesPage.Surface;
  SlideImage.Stretch := True;
  SlideImage.Height := ImgH;
  SlideImage.Width := (ImgH * 16) div 9;
  SlideImage.Left := (W - SlideImage.Width) div 2;
  SlideImage.Top := 0;

  BelowTop := ImgH + ScaleY(6);

  SlideTitle := TNewStaticText.Create(SlidesPage);
  SlideTitle.Parent := SlidesPage.Surface;
  SlideTitle.Left := SlideImage.Left;
  SlideTitle.Top := BelowTop;
  SlideTitle.Width := SlideImage.Width - ScaleX(140);
  SlideTitle.Font.Style := [fsBold];

  SlideText := TNewStaticText.Create(SlidesPage);
  SlideText.Parent := SlidesPage.Surface;
  SlideText.Left := SlideImage.Left;
  SlideText.Top := BelowTop + ScaleY(18);
  SlideText.Width := SlideImage.Width - ScaleX(140);
  SlideText.AutoSize := False;
  SlideText.WordWrap := True;
  SlideText.Height := ScaleY(32);

  SlidePrev := TNewButton.Create(SlidesPage);
  SlidePrev.Parent := SlidesPage.Surface;
  SlidePrev.Caption := '<';
  SlidePrev.Width := ScaleX(60);
  SlidePrev.Height := ScaleY(23);
  SlidePrev.Left := SlideImage.Left + SlideImage.Width - ScaleX(130);
  SlidePrev.Top := BelowTop;
  SlidePrev.OnClick := @SlideNavClick;

  SlideNext := TNewButton.Create(SlidesPage);
  SlideNext.Parent := SlidesPage.Surface;
  SlideNext.Caption := '>';
  SlideNext.Width := ScaleX(60);
  SlideNext.Height := ScaleY(23);
  SlideNext.Left := SlideImage.Left + SlideImage.Width - ScaleX(64);
  SlideNext.Top := BelowTop;
  SlideNext.OnClick := @SlideNavClick;

  ShowSlide(0);
end;

{ ---------- Type de compte ---------- }

procedure CreateAccountPage;
begin
  AccountPage := CreateInputOptionPage(SlidesPage.ID,
    'Type de compte',
    'Comment veux-tu utiliser Noteo ?',
    'Tu pourras changer ce choix plus tard, dans « Mon compte ». Par sécurité, aucun mot de passe n''est saisi ici : Noteo ouvrira directement l''écran voulu à son premier lancement.',
    True, False);
  AccountPage.Add('Aucun compte : les notes restent sur cet appareil');
  AccountPage.Add('Compte local : identifiant et mot de passe, notes sur cet appareil');
  AccountPage.Add('Compte en ligne : créer un nouveau compte (notes synchronisées)');
  AccountPage.Add('Compte en ligne : me connecter à mon compte existant');
  AccountPage.SelectedValueIndex := 0;
end;

procedure InitializeWizard;
begin
  WasInstalled := IsUpgrade();
  CreateSlidesPage;
  CreateAccountPage;
end;

{ Lors d'une mise à jour, on ne repose pas la question du type de compte }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (AccountPage <> nil) and (PageID = AccountPage.ID) then
    Result := WasInstalled;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  AccountType, OnlineMode: String;
begin
  if (CurStep = ssPostInstall) and (not WasInstalled) then
  begin
    case AccountPage.SelectedValueIndex of
      1: begin AccountType := 'local';  OnlineMode := 'create'; end;
      2: begin AccountType := 'online'; OnlineMode := 'create'; end;
      3: begin AccountType := 'online'; OnlineMode := 'login';  end;
    else
      begin AccountType := 'none'; OnlineMode := 'create'; end;
    end;
    { "id" : identifiant unique de cette installation, pour que Noteo n'applique le choix qu'une fois }
    SaveStringToFile(ExpandConstant('{app}\noteo-setup.json'),
      '{"id":"' + GetDateTimeString('yyyymmddhhnnss', #0, #0) + '","accountType":"' + AccountType + '","onlineMode":"' + OnlineMode + '"}', False);
  end;
end;

{ ---------- Page "Prêt à installer" ---------- }
{ Le résumé standard d'Inno est une grande zone de texte avec ascenseurs.
  On la remplace par un simple texte, plus propre. }

function AccountSummary(): String;
begin
  if WasInstalled then
    Result := 'inchangé (mise à jour)'
  else
    case AccountPage.SelectedValueIndex of
      1: Result := 'compte local';
      2: Result := 'compte en ligne (création au premier lancement)';
      3: Result := 'compte en ligne (connexion au premier lancement)';
    else
      Result := 'aucun compte';
    end;
end;

function ShortcutsSummary(): String;
begin
  Result := '';
  if WizardIsTaskSelected('desktopicon') then
    Result := 'Bureau';
  if WizardIsTaskSelected('startmenuicon') then
  begin
    if Result <> '' then
      Result := Result + ', ';
    Result := Result + 'menu Démarrer';
  end;
  if Result = '' then
    Result := 'aucun';
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpReady then
  begin
    WizardForm.ReadyMemo.Visible := False;
    if not ReadySummaryCreated then
    begin
      ReadySummary := TNewStaticText.Create(WizardForm);
      ReadySummary.Parent := WizardForm.ReadyPage;
      ReadySummary.AutoSize := False;
      ReadySummary.WordWrap := True;
      ReadySummary.Left := WizardForm.ReadyMemo.Left;
      ReadySummary.Top := WizardForm.ReadyMemo.Top;
      ReadySummary.Width := WizardForm.ReadyMemo.Width;
      ReadySummary.Height := WizardForm.ReadyMemo.Height;
      ReadySummaryCreated := True;
    end;
    ReadySummary.Caption :=
      'Dossier d''installation' + #13#10 +
      '      ' + WizardDirValue + #13#10 + #13#10 +
      'Type de compte' + #13#10 +
      '      ' + AccountSummary() + #13#10 + #13#10 +
      'Raccourcis' + #13#10 +
      '      ' + ShortcutsSummary();
  end;
end;

{ ---------- Désinstallation ---------- }

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
  begin
    if MsgBox('Supprimer aussi les données locales de Noteo (notes enregistrées sur cet ordinateur, fonds, réglages) ?' + #13#10 + #13#10 +
              'Les comptes en ligne ne sont pas concernés : tes notes en ligne restent disponibles.',
              mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{userappdata}\Noteo'), True, True, True);
  end;
end;
