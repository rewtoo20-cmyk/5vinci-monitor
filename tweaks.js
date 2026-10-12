// Команды оптимизации. Всё выполняется через PowerShell, каждое изменение можно откатить.
'use strict';
const { execFile } = require('child_process');
const path = require('path');
const META = require('./renderer/meta.js');

const PSEXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const PRE = "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;";
const MAX_ENC = 30000; // предел длины командной строки Windows
function ps(script, timeout) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, out: '', err: 'Работает только в Windows' });
    const enc = Buffer.from(PRE + script, 'utf16le').toString('base64');
    if (enc.length > MAX_ENC) return resolve({ ok: false, out: '', err: 'Внутренняя ошибка: команда слишком длинная' });
    execFile(PSEXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { windowsHide: true, timeout: timeout || 90000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim().split('\n')[0] }));
  });
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const pv = (v) => (typeof v === 'number' ? String(v) : q(v));
const items = (keys) => '@(' + keys.map((k) => `@{p=${q(k.p)};n=${q(k.n)};v=${pv(k.v)};t=${q(k.t || 'DWord')}}`).join(',') + ')';

// ---- реестр: запоминаем прежние значения и умеем вернуть ----
const regCheck = (keys) => `$ok=$true;foreach($i in ${items(keys)}){$c=$null;try{$c=(Get-ItemProperty -Path $i.p -Name $i.n -ErrorAction Stop).($i.n)}catch{};if("$c" -ne "$($i.v)"){$ok=$false}};$ok`;
const regApply = (keys) => `$prev=@{};foreach($i in ${items(keys)}){$c=$null;try{$c=(Get-ItemProperty -Path $i.p -Name $i.n -ErrorAction Stop).($i.n)}catch{};$prev[$i.p+'|'+$i.n]=$c;if(-not(Test-Path $i.p)){New-Item -Path $i.p -Force|Out-Null};Set-ItemProperty -Path $i.p -Name $i.n -Value $i.v -Type $i.t -Force};$prev|ConvertTo-Json -Compress`;
const regRevert = (keys, prev) => `$prev=${q(JSON.stringify(prev || {}))}|ConvertFrom-Json;foreach($i in ${items(keys)}){$k=$i.p+'|'+$i.n;$pr=$prev.PSObject.Properties|Where-Object{$_.Name -eq $k};if($pr -and $null -ne $pr.Value){Set-ItemProperty -Path $i.p -Name $i.n -Value $pr.Value -Force}else{Remove-ItemProperty -Path $i.p -Name $i.n -ErrorAction SilentlyContinue}};'ok'`;

// ---- службы ----
const svcList = (names) => '@(' + names.map(q).join(',') + ')';
const svcCheck = (names) => `$ok=$true;$n=0;foreach($s in ${svcList(names)}){$x=Get-Service -Name $s -ErrorAction SilentlyContinue;if($x){$n++;if([string]$x.StartType -ne 'Disabled'){$ok=$false}}};if($n -eq 0){'na'}else{$ok}`;
const svcApply = (names) => `$r=@{};foreach($s in ${svcList(names)}){$x=Get-Service -Name $s -ErrorAction SilentlyContinue;if($x){$r[$s]=[string]$x.StartType;Set-Service -Name $s -StartupType Disabled -ErrorAction SilentlyContinue;Stop-Service -Name $s -Force -ErrorAction SilentlyContinue}};$r|ConvertTo-Json -Compress`;
const svcRevert = (names, prev) => `$prev=${q(JSON.stringify(prev || {}))}|ConvertFrom-Json;foreach($s in ${svcList(names)}){$x=Get-Service -Name $s -ErrorAction SilentlyContinue;if($x){$t='Manual';$pr=$prev.PSObject.Properties|Where-Object{$_.Name -eq $s};if($pr -and $pr.Value -and $pr.Value -ne 'Disabled'){$t=$pr.Value};Set-Service -Name $s -StartupType $t -ErrorAction SilentlyContinue;if($t -eq 'Automatic'){Start-Service -Name $s -ErrorAction SilentlyContinue}}};'ok'`;

const GUID = { plan_saver: 'a1841308-3541-4fab-bc81-f71556f20b4a', plan_bal: '381b4222-f694-41f0-9685-ff5bb260df2e', plan_perf: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' };
const HK = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion';
const EXA = HK + '\\Explorer\\Advanced';
const MM = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile';
const POL = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows';
const CLSID = 'HKCU:\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}';
const USB = '2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226';
const S = (p, n, v) => ({ p, n, v: String(v), t: 'String' });

const IMPL = {
  // Интернет
  dns_cf: {
    check: "$a=@(Get-NetAdapter|Where-Object Status -eq 'Up');$ok=$false;foreach($x in $a){$d=(Get-DnsClientServerAddress -InterfaceIndex $x.ifIndex -AddressFamily IPv4).ServerAddresses;if($d -contains '1.1.1.1'){$ok=$true}};$ok",
    apply: "$a=@(Get-NetAdapter|Where-Object Status -eq 'Up');foreach($x in $a){Set-DnsClientServerAddress -InterfaceIndex $x.ifIndex -ServerAddresses ('1.1.1.1','1.0.0.1')};'{}'",
    revert: "$a=@(Get-NetAdapter|Where-Object Status -eq 'Up');foreach($x in $a){Set-DnsClientServerAddress -InterfaceIndex $x.ifIndex -ResetServerAddresses};'ok'",
  },
  do_off: { keys: [{ p: POL + '\\DeliveryOptimization', n: 'DODownloadMode', v: 0 }] },
  ping_test: { run: "try{$r=@(Test-Connection -ComputerName 1.1.1.1 -Count 4 -ErrorAction Stop);$a=[math]::Round(($r|Measure-Object ResponseTime -Average).Average);\"Пинг до 1.1.1.1: $a мс\"}catch{'Нет ответа. Проверь подключение к интернету'}" },
  flush_dns: { run: 'ipconfig /flushdns|Out-Null;"Кэш DNS очищен"' },
  renew_ip: { run: "ipconfig /release|Out-Null;ipconfig /renew|Out-Null;'IP-адрес обновлён'" },
  net_reset: { run: "netsh winsock reset|Out-Null;netsh int ip reset|Out-Null;'Готово. Перезагрузи компьютер'" },
  // Питание
  plan_saver: { choice: true }, plan_bal: { choice: true }, plan_perf: { choice: true },
  batt30: { stateOnly: true, apply: "powercfg /setdcvalueindex SCHEME_CURRENT SUB_ENERGYSAVER ESBATTTHRESHOLD 30|Out-Null;powercfg /setactive SCHEME_CURRENT|Out-Null;'{}'", revert: "powercfg /setdcvalueindex SCHEME_CURRENT SUB_ENERGYSAVER ESBATTTHRESHOLD 20|Out-Null;powercfg /setactive SCHEME_CURRENT|Out-Null;'ok'" },
  bgapps: { keys: [{ p: HK + '\\BackgroundAccessApplications', n: 'GlobalUserDisabled', v: 1 }, { p: HK + '\\Search', n: 'BackgroundAppGlobalToggle', v: 0 }] },
  hib_off: {
    check: "(Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power' -Name HibernateEnabled).HibernateEnabled -eq 0",
    apply: "powercfg /hibernate off|Out-Null;'{}'", revert: "powercfg /hibernate on|Out-Null;'ok'",
  },
  fast_off: { keys: [{ p: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power', n: 'HiberbootEnabled', v: 0 }] },
  usb_susp: {
    stateOnly: true,
    apply: `powercfg /setacvalueindex SCHEME_CURRENT ${USB} 0|Out-Null;powercfg /setdcvalueindex SCHEME_CURRENT ${USB} 0|Out-Null;powercfg /setactive SCHEME_CURRENT|Out-Null;'{}'`,
    revert: `powercfg /setacvalueindex SCHEME_CURRENT ${USB} 1|Out-Null;powercfg /setdcvalueindex SCHEME_CURRENT ${USB} 1|Out-Null;powercfg /setactive SCHEME_CURRENT|Out-Null;'ok'`,
  },
  batt_report: { run: "$f=Join-Path ([Environment]::GetFolderPath('Desktop')) 'battery-report.html';powercfg /batteryreport /output $f|Out-Null;if(Test-Path -LiteralPath $f){'Отчёт сохранён на рабочем столе: battery-report.html'}else{throw 'У этого компьютера нет батареи'}" },
  // Производительность
  gamemode: { keys: [{ p: 'HKCU:\\Software\\Microsoft\\GameBar', n: 'AutoGameModeEnabled', v: 1 }, { p: 'HKCU:\\Software\\Microsoft\\GameBar', n: 'AllowAutoGameMode', v: 1 }] },
  gamedvr: { keys: [{ p: 'HKCU:\\System\\GameConfigStore', n: 'GameDVR_Enabled', v: 0 }, { p: HK + '\\GameDVR', n: 'AppCaptureEnabled', v: 0 }] },
  mmcss: { keys: [{ p: MM, n: 'SystemResponsiveness', v: 0 }, { p: MM, n: 'NetworkThrottlingIndex', v: -1 }, { p: MM + '\\Tasks\\Games', n: 'GPU Priority', v: 8 }, { p: MM + '\\Tasks\\Games', n: 'Priority', v: 6 }, S(MM + '\\Tasks\\Games', 'Scheduling Category', 'High')] },
  startdelay: { keys: [{ p: HK + '\\Explorer\\Serialize', n: 'StartupDelayInMSec', v: 0 }] },
  menu_delay: { keys: [S('HKCU:\\Control Panel\\Desktop', 'MenuShowDelay', 0)] },
  fast_shut: { keys: [S('HKCU:\\Control Panel\\Desktop', 'WaitToKillAppTimeout', 2000), S('HKCU:\\Control Panel\\Desktop', 'HungAppTimeout', 1000), S('HKLM:\\SYSTEM\\CurrentControlSet\\Control', 'WaitToKillServiceTimeout', 2000)] },
  fx: { keys: [{ p: HK + '\\Themes\\Personalize', n: 'EnableTransparency', v: 0 }, S('HKCU:\\Control Panel\\Desktop\\WindowMetrics', 'MinAnimate', 0), { p: EXA, n: 'TaskbarAnimations', v: 0 }] },
  mouse_accel: { keys: [S('HKCU:\\Control Panel\\Mouse', 'MouseSpeed', 0), S('HKCU:\\Control Panel\\Mouse', 'MouseThreshold1', 0), S('HKCU:\\Control Panel\\Mouse', 'MouseThreshold2', 0)] },
  lastaccess: { keys: [{ p: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', n: 'NtfsDisableLastAccessUpdate', v: 1 }] },
  hags: { keys: [{ p: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', n: 'HwSchMode', v: 2 }] },
  pthrottle: { keys: [{ p: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', n: 'PowerThrottlingOff', v: 1 }] },
  ram_free: { run: "Add-Type -Namespace W -Name M -MemberDefinition '[DllImport(\"psapi.dll\")] public static extern bool EmptyWorkingSet(IntPtr h);';$b=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;foreach($p in Get-Process){try{[W.M]::EmptyWorkingSet($p.Handle)|Out-Null}catch{}};Start-Sleep -Seconds 2;$a=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;$d=[math]::Max(0,[math]::Round(($a-$b)/1024));\"Освобождено памяти: $d МБ\"" },
  // Приватность
  tips: { keys: ['SubscribedContent-338388Enabled', 'SubscribedContent-338389Enabled', 'SubscribedContent-353694Enabled', 'SubscribedContent-353696Enabled', 'SystemPaneSuggestionsEnabled', 'SoftLandingEnabled', 'RotatingLockScreenOverlayEnabled'].map((n) => ({ p: HK + '\\ContentDeliveryManager', n, v: 0 })) },
  adid: { keys: [{ p: HK + '\\AdvertisingInfo', n: 'Enabled', v: 0 }] },
  bing_search: { keys: [{ p: 'HKCU:\\Software\\Policies\\Microsoft\\Windows\\Explorer', n: 'DisableSearchBoxSuggestions', v: 1 }] },
  activity: { keys: ['PublishUserActivities', 'UploadUserActivities', 'EnableActivityFeed'].map((n) => ({ p: POL + '\\System', n, v: 0 })) },
  telemetry_lvl: { keys: [{ p: POL + '\\DataCollection', n: 'AllowTelemetry', v: 0 }] },
  tailored: { keys: [{ p: HK + '\\Privacy', n: 'TailoredExperiencesWithDiagnosticDataEnabled', v: 0 }] },
  inkpers: { keys: [{ p: 'HKCU:\\Software\\Microsoft\\InputPersonalization', n: 'RestrictImplicitTextCollection', v: 1 }, { p: 'HKCU:\\Software\\Microsoft\\InputPersonalization', n: 'RestrictImplicitInkCollection', v: 1 }] },
  wer: { keys: [{ p: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting', n: 'Disabled', v: 1 }] },
  feedback: { keys: [{ p: 'HKCU:\\Software\\Microsoft\\Siuf\\Rules', n: 'NumberOfSIUFInPeriod', v: 0 }] },
  // Проводник и интерфейс
  ext: { keys: [{ p: EXA, n: 'HideFileExt', v: 0 }] },
  hidden: { keys: [{ p: EXA, n: 'Hidden', v: 1 }] },
  thispc: { keys: [{ p: EXA, n: 'LaunchTo', v: 1 }] },
  dark: { keys: [{ p: HK + '\\Themes\\Personalize', n: 'AppsUseLightTheme', v: 0 }, { p: HK + '\\Themes\\Personalize', n: 'SystemUsesLightTheme', v: 0 }] },
  classic_menu: {
    check: `Test-Path -LiteralPath '${CLSID}\\InprocServer32'`,
    apply: `New-Item -Path '${CLSID}\\InprocServer32' -Force|Out-Null;Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue;'{}'`,
    revert: `Remove-Item -LiteralPath '${CLSID}' -Recurse -Force -ErrorAction SilentlyContinue;Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue;'ok'`,
  },
  taskbar_widgets: { keys: [{ p: EXA, n: 'TaskbarDa', v: 0 }, { p: EXA, n: 'TaskbarMn', v: 0 }] },
  taskbar_search: { keys: [{ p: HK + '\\Search', n: 'SearchboxTaskbarMode', v: 0 }] },
  taskview: { keys: [{ p: EXA, n: 'ShowTaskViewButton', v: 0 }] },
  seconds: { keys: [{ p: EXA, n: 'ShowSecondsInSystemClock', v: 1 }] },
  sticky: { keys: [S('HKCU:\\Control Panel\\Accessibility\\StickyKeys', 'Flags', 506), S('HKCU:\\Control Panel\\Accessibility\\Keyboard Response', 'Flags', 122), S('HKCU:\\Control Panel\\Accessibility\\ToggleKeys', 'Flags', 58)] },
  long_paths: { keys: [{ p: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', n: 'LongPathsEnabled', v: 1 }] },
  // Службы
  svc_telemetry: { services: ['DiagTrack', 'dmwappushservice'] },
  svc_rare: { services: ['Fax', 'RetailDemo', 'MapsBroker', 'WMPNetworkSvc', 'RemoteRegistry'] },
  svc_insider: { services: ['wisvc'] },
  svc_smartcard: { services: ['SCardSvr', 'ScDeviceEnum', 'SCPolicySvc'] },
  svc_xbox: { services: ['XblAuthManager', 'XblGameSave', 'XboxNetApiSvc', 'XboxGipSvc'] },
  svc_sysmain: { services: ['SysMain'] },
  svc_rdp: { services: ['TermService', 'UmRdpService', 'SessionEnv'] },
  svc_print: { services: ['Spooler'] },
  svc_search: { services: ['WSearch'] },
};
for (const id of Object.keys(IMPL)) {
  const t = IMPL[id];
  if (t.keys) { t.check = regCheck(t.keys); t.apply = regApply(t.keys); t.revertFn = (prev) => regRevert(t.keys, prev); }
  else if (t.services) { t.check = svcCheck(t.services); t.apply = svcApply(t.services); t.revertFn = (prev) => svcRevert(t.services, prev); }
  else if (t.revert) { t.revertFn = () => t.revert; }
}
const known = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(IMPL, id) && META.TWEAKS.some((x) => x.id === id);

// Проверка состояния всех оптимизаций: несколькими запусками PowerShell (у командной строки Windows есть предел длины)
async function checkAll() {
  const head = "$r=@{};$r['_plan']=((powercfg /getactivescheme) -join ' ');try{$r['_laptop']=[bool](Get-CimInstance Win32_Battery -ErrorAction Stop)}catch{$r['_laptop']=$false};try{$r['_build']=[int](Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).BuildNumber}catch{$r['_build']=0};try{$r['_admin']=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}catch{$r['_admin']=$false};";
  const batches = []; let cur = head;
  for (const t of META.TWEAKS) {
    const im = IMPL[t.id];
    if (!im || im.stateOnly || im.run || im.choice) continue;
    const part = `try{$v=& {${im.check}};if($v -is [array]){$v=$v[-1]};$r[${q(t.id)}]=$v}catch{$r[${q(t.id)}]=$false};`;
    if (cur.length + part.length > 9000) { batches.push(cur); cur = "$r=@{};"; }
    cur += part;
  }
  batches.push(cur);
  const res = await Promise.all(batches.map((b) => ps(b + '$r|ConvertTo-Json -Compress', 120000)));
  const map = {}; let ok = true, err = '';
  for (const r of res) { try { Object.assign(map, JSON.parse(r.out)); } catch (e) { ok = false; err = err || r.err; } }
  return { map, ok, err };
}

async function applyOne(id, state) {
  if (!known(id)) return { ok: false, msg: 'Неизвестная оптимизация' };
  const im = IMPL[id];
  if (im.run) { const r = await ps(im.run, 120000); return { ok: r.ok, msg: r.ok ? (r.out || 'Готово') : (r.err || 'Не получилось'), action: true }; }
  if (im.choice) {
    const r = await ps(`powercfg /setactive ${GUID[id]};if($LASTEXITCODE -ne 0){throw 'Этот план питания недоступен на твоём компьютере'};'{}'`);
    return { ok: r.ok, msg: r.ok ? 'Готово' : r.err, prev: {}, choice: true };
  }
  const r = await ps(im.apply);
  if (!r.ok) return { ok: false, msg: r.err || 'Не получилось. Запусти программу от имени администратора' };
  let prev = {}; try { prev = JSON.parse(r.out || '{}'); } catch (e) {}
  return { ok: true, msg: 'Готово', prev };
}
async function revertOne(id, prev) {
  if (!known(id)) return { ok: false, msg: 'Неизвестная оптимизация' };
  const im = IMPL[id];
  if (im.choice) { const r = await ps(`powercfg /setactive ${GUID.plan_bal}`); return { ok: r.ok, msg: r.ok ? 'Готово' : r.err }; }
  if (!im.revertFn) return { ok: false, msg: 'Нечего откатывать' };
  const r = await ps(im.revertFn(prev && typeof prev === 'object' ? prev : {}));
  return { ok: r.ok, msg: r.ok ? 'Готово' : r.err };
}

// ---- автозагрузка ----
const RUNKEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\';
const APPR = { HKCU: 'HKCU:\\' + RUNKEY + 'Run', HKLM: 'HKLM:\\' + RUNKEY + 'Run', HKLM32: 'HKLM:\\' + RUNKEY + 'Run32', HKCUF: 'HKCU:\\' + RUNKEY + 'StartupFolder', HKLMF: 'HKLM:\\' + RUNKEY + 'StartupFolder' };
async function startupList() {
  const s = `$out=@();
$locs=@(@{k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';a=${q(APPR.HKCU)};s='HKCU'},@{k='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';a=${q(APPR.HKLM)};s='HKLM'},@{k='HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run';a=${q(APPR.HKLM32)};s='HKLM32'});
foreach($l in $locs){if(Test-Path $l.k){$p=Get-ItemProperty $l.k;foreach($pr in $p.PSObject.Properties){if($pr.Name -like 'PS*'){continue};$en=$true;if(Test-Path $l.a){$b=(Get-ItemProperty $l.a -ErrorAction SilentlyContinue).($pr.Name);if($b -and ($b[0] -band 1)){$en=$false}};$out+=[pscustomobject]@{id=$l.s+'|'+$pr.Name;name=$pr.Name;cmd=[string]$pr.Value;src='Реестр';enabled=$en}}}};
$fl=@(@{d=(Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup');a=${q(APPR.HKCUF)};s='HKCUF'},@{d=(Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs\\StartUp');a=${q(APPR.HKLMF)};s='HKLMF'});
foreach($l in $fl){if(Test-Path $l.d){foreach($f in Get-ChildItem $l.d -File -ErrorAction SilentlyContinue){if($f.Name -eq 'desktop.ini'){continue};$en=$true;if(Test-Path $l.a){$b=(Get-ItemProperty $l.a -ErrorAction SilentlyContinue).($f.Name);if($b -and ($b[0] -band 1)){$en=$false}};$out+=[pscustomobject]@{id=$l.s+'|'+$f.Name;name=[IO.Path]::GetFileNameWithoutExtension($f.Name);cmd=$f.FullName;src='Папка автозагрузки';enabled=$en}}}};
ConvertTo-Json -InputObject @($out) -Compress`;
  const r = await ps(s);
  let list = []; try { list = JSON.parse(r.out); } catch (e) {}
  return { ok: r.ok, err: r.err, list: Array.isArray(list) ? list : [] };
}
async function startupSet(id, enabled) {
  if (typeof id !== 'string' || id.length > 400 || /[\u0000-\u001f]/.test(id)) return { ok: false, msg: 'Неизвестный пункт' };
  const i = id.indexOf('|'); if (i < 0) return { ok: false, msg: 'Неизвестный пункт' };
  const src = id.slice(0, i), name = id.slice(i + 1);
  if (!Object.prototype.hasOwnProperty.call(APPR, src) || !name) return { ok: false, msg: 'Неизвестный пункт' };
  const bytes = (enabled ? [2] : [3]).concat([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).join(',');
  const r = await ps(`$k=${q(APPR[src])};if(-not(Test-Path $k)){New-Item -Path $k -Force|Out-Null};Set-ItemProperty -LiteralPath $k -Name ${q(name)} -Value ([byte[]](${bytes})) -Type Binary -Force;'ok'`);
  return { ok: r.ok, msg: r.ok ? 'Готово' : r.err };
}

// ---- очистка ----
// Пути записаны как строки PowerShell (в двойных кавычках, чтобы работали переменные окружения)
const CH = (sub) => `"$env:LOCALAPPDATA\\${sub}"`;
const BROWSER = (root) => ['Cache', 'Code Cache', 'GPUCache'].map((x) => CH(`${root}\\User Data\\Default\\${x}`));
const CLEAN = [
  { id: 'temp_user', title: 'Временные файлы пользователя', paths: ['"$env:TEMP"'] },
  { id: 'temp_win', title: 'Временные файлы Windows', paths: ['"$env:SystemRoot\\Temp"'] },
  { id: 'wu_cache', title: 'Кэш обновлений Windows', paths: ['"$env:SystemRoot\\SoftwareDistribution\\Download"'] },
  { id: 'do_cache', title: 'Кэш доставки обновлений', paths: ['"$env:SystemRoot\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache"'] },
  { id: 'dx', title: 'Кэш шейдеров (DirectX, NVIDIA, AMD)', paths: [CH('D3DSCache'), CH('NVIDIA\\DXCache'), CH('NVIDIA\\GLCache'), CH('AMD\\DxCache')] },
  { id: 'edge', title: 'Кэш браузера Edge', paths: BROWSER('Microsoft\\Edge') },
  { id: 'chrome', title: 'Кэш браузера Chrome', paths: BROWSER('Google\\Chrome') },
  { id: 'brave', title: 'Кэш браузера Brave', paths: BROWSER('BraveSoftware\\Brave-Browser') },
  { id: 'firefox', title: 'Кэш браузера Firefox', paths: [CH('Mozilla\\Firefox\\Profiles\\*\\cache2')] },
  { id: 'discord', title: 'Кэш Discord', paths: ['Cache', 'Code Cache', 'GPUCache'].map((x) => `"$env:APPDATA\\discord\\${x}"`) },
  { id: 'thumbs', title: 'Кэш миниатюр Проводника', paths: [CH('Microsoft\\Windows\\Explorer')], filter: 'thumbcache_*.db', flat: true },
  { id: 'dumps', title: 'Дампы сбоев Windows', paths: ['"$env:SystemRoot\\Minidump"', CH('CrashDumps')] },
  { id: 'wer_files', title: 'Отчёты об ошибках', paths: ['"$env:ProgramData\\Microsoft\\Windows\\WER"'] },
  { id: 'recycle', title: 'Корзина', recycle: true },
];
const gci = (c, extra) => `foreach($e in @(${c.paths.join(',')})){foreach($x in @(Get-Item -Path $e -ErrorAction SilentlyContinue)){${extra}}};`;
async function cleanScan() {
  const lines = CLEAN.map((c) => c.recycle
    ? `try{$sh=New-Object -ComObject Shell.Application;$n=0;foreach($i in $sh.NameSpace(0xA).Items()){$n+=[double]$i.Size};$r[${q(c.id)}]=$n}catch{$r[${q(c.id)}]=0};`
    : `try{$t=[double]0;${gci(c, `$t+=[double](Get-ChildItem -LiteralPath $x.FullName ${c.flat ? '' : '-Recurse '}-Force -File ${c.filter ? '-Filter ' + q(c.filter) + ' ' : ''}-ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum`)}$r[${q(c.id)}]=$t}catch{$r[${q(c.id)}]=0};`);
  // несколько запусков, чтобы не упереться в предел длины команды
  const half = Math.ceil(lines.length / 2);
  const res = await Promise.all([lines.slice(0, half), lines.slice(half)].map((l) => ps(`$r=@{};${l.join('')}$r|ConvertTo-Json -Compress`, 180000)));
  const m = {}; let ok = true;
  for (const r of res) { try { Object.assign(m, JSON.parse(r.out)); } catch (e) { ok = false; } }
  return { ok, items: CLEAN.map((c) => ({ id: c.id, title: c.title, size: Number(m[c.id]) || 0 })) };
}
async function cleanRun(ids) {
  if (!Array.isArray(ids)) return { ok: false };
  const sel = CLEAN.filter((c) => ids.includes(c.id));
  if (!sel.length) return { ok: true };
  const lines = sel.map((c) => c.recycle
    ? 'try{Clear-RecycleBin -Force -ErrorAction SilentlyContinue}catch{};'
    : `try{${gci(c, `Get-ChildItem -LiteralPath $x.FullName -Force ${c.filter ? '-Filter ' + q(c.filter) + ' ' : ''}-ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`)}}catch{};`);
  const half = Math.ceil(lines.length / 2);
  const res = await Promise.all([lines.slice(0, half), lines.slice(half)].filter((l) => l.length).map((l) => ps(`${l.join('')}'ok'`, 240000)));
  return { ok: res.every((r) => r.ok) };
}

async function createRestorePoint() {
  const r = await ps("Enable-ComputerRestore -Drive $env:SystemDrive -ErrorAction SilentlyContinue;Checkpoint-Computer -Description '5VINCI Optimizer' -RestorePointType MODIFY_SETTINGS;'ok'", 120000);
  return { ok: r.ok, msg: r.ok ? 'Точка восстановления создана' : 'Windows не дала создать точку (защита системы выключена)' };
}

module.exports = { META, IMPL, ps, checkAll, applyOne, revertOne, startupList, startupSet, cleanScan, cleanRun, createRestorePoint, GUID, known, CLEAN, MAX_ENC };
