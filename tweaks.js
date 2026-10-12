// Команды оптимизации. Всё выполняется через PowerShell, каждое изменение можно откатить.
'use strict';
const { execFile } = require('child_process');
const META = require('./renderer/meta.js');

const PRE = "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;";
function ps(script, timeout) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, out: '', err: 'Работает только в Windows' });
    const enc = Buffer.from(PRE + script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
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
const svcCheck = (names) => `$ok=$true;$n=0;foreach($s in ${svcList(names)}){$x=Get-Service -Name $s -ErrorAction SilentlyContinue;if($x){$n++;if([string]$x.StartType -ne 'Disabled'){$ok=$false}}};($ok -and $n -gt 0)`;
const svcApply = (names) => `$r=@{};foreach($s in ${svcList(names)}){$x=Get-Service -Name $s -ErrorAction SilentlyContinue;if($x){$r[$s]=[string]$x.StartType;Set-Service -Name $s -StartupType Disabled -ErrorAction SilentlyContinue;Stop-Service -Name $s -Force -ErrorAction SilentlyContinue}};$r|ConvertTo-Json -Compress`;
const svcRevert = (names, prev) => `$prev=${q(JSON.stringify(prev || {}))}|ConvertFrom-Json;foreach($s in ${svcList(names)}){$x=Get-Service -Name $s -ErrorAction SilentlyContinue;if($x){$t='Manual';$pr=$prev.PSObject.Properties|Where-Object{$_.Name -eq $s};if($pr -and $pr.Value -and $pr.Value -ne 'Disabled'){$t=$pr.Value};Set-Service -Name $s -StartupType $t -ErrorAction SilentlyContinue;if($t -eq 'Automatic'){Start-Service -Name $s -ErrorAction SilentlyContinue}}};'ok'`;

const GUID = { plan_saver: 'a1841308-3541-4fab-bc81-f71556f20b4a', plan_bal: '381b4222-f694-41f0-9685-ff5bb260df2e', plan_perf: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' };
const HK = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion';

const IMPL = {
  dns_cf: {
    check: "$a=@(Get-NetAdapter|Where-Object Status -eq 'Up');$ok=$false;foreach($x in $a){$d=(Get-DnsClientServerAddress -InterfaceIndex $x.ifIndex -AddressFamily IPv4).ServerAddresses;if($d -contains '1.1.1.1'){$ok=$true}};$ok",
    apply: "$a=@(Get-NetAdapter|Where-Object Status -eq 'Up');foreach($x in $a){Set-DnsClientServerAddress -InterfaceIndex $x.ifIndex -ServerAddresses ('1.1.1.1','1.0.0.1')};'{}'",
    revert: "$a=@(Get-NetAdapter|Where-Object Status -eq 'Up');foreach($x in $a){Set-DnsClientServerAddress -InterfaceIndex $x.ifIndex -ResetServerAddresses};'ok'",
  },
  do_off: { keys: [{ p: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization', n: 'DODownloadMode', v: 0 }] },
  flush_dns: { run: 'ipconfig /flushdns|Out-Null;"Кэш DNS очищен"' },
  net_reset: { run: "netsh winsock reset|Out-Null;netsh int ip reset|Out-Null;'Готово. Перезагрузи компьютер'" },
  plan_saver: { choice: true }, plan_bal: { choice: true }, plan_perf: { choice: true },
  batt30: { stateOnly: true, apply: "powercfg /setdcvalueindex SCHEME_CURRENT SUB_ENERGYSAVER ESBATTTHRESHOLD 30|Out-Null;powercfg /setactive SCHEME_CURRENT|Out-Null;'{}'", revert: "powercfg /setdcvalueindex SCHEME_CURRENT SUB_ENERGYSAVER ESBATTTHRESHOLD 20|Out-Null;powercfg /setactive SCHEME_CURRENT|Out-Null;'ok'" },
  bgapps: { keys: [{ p: HK + '\\BackgroundAccessApplications', n: 'GlobalUserDisabled', v: 1 }, { p: HK + '\\Search', n: 'BackgroundAppGlobalToggle', v: 0 }] },
  gamemode: { keys: [{ p: 'HKCU:\\Software\\Microsoft\\GameBar', n: 'AutoGameModeEnabled', v: 1 }, { p: 'HKCU:\\Software\\Microsoft\\GameBar', n: 'AllowAutoGameMode', v: 1 }] },
  gamedvr: { keys: [{ p: 'HKCU:\\System\\GameConfigStore', n: 'GameDVR_Enabled', v: 0 }, { p: HK + '\\GameDVR', n: 'AppCaptureEnabled', v: 0 }] },
  startdelay: { keys: [{ p: HK + '\\Explorer\\Serialize', n: 'StartupDelayInMSec', v: 0 }] },
  tips: { keys: ['SubscribedContent-338388Enabled', 'SubscribedContent-338389Enabled', 'SubscribedContent-353694Enabled', 'SubscribedContent-353696Enabled', 'SystemPaneSuggestionsEnabled', 'SoftLandingEnabled', 'RotatingLockScreenOverlayEnabled'].map((n) => ({ p: HK + '\\ContentDeliveryManager', n, v: 0 })) },
  fx: { keys: [{ p: HK + '\\Themes\\Personalize', n: 'EnableTransparency', v: 0 }, { p: 'HKCU:\\Control Panel\\Desktop\\WindowMetrics', n: 'MinAnimate', v: '0', t: 'String' }, { p: HK + '\\Explorer\\Advanced', n: 'TaskbarAnimations', v: 0 }] },
  svc_telemetry: { services: ['DiagTrack', 'dmwappushservice'] },
  svc_rare: { services: ['Fax', 'RetailDemo', 'MapsBroker', 'WMPNetworkSvc', 'RemoteRegistry'] },
  svc_xbox: { services: ['XblAuthManager', 'XblGameSave', 'XboxNetApiSvc', 'XboxGipSvc'] },
  svc_print: { services: ['Spooler'] },
  svc_search: { services: ['WSearch'] },
};
for (const id of Object.keys(IMPL)) {
  const t = IMPL[id];
  if (t.keys) { t.check = regCheck(t.keys); t.apply = regApply(t.keys); t.revertFn = (prev) => regRevert(t.keys, prev); }
  else if (t.services) { t.check = svcCheck(t.services); t.apply = svcApply(t.services); t.revertFn = (prev) => svcRevert(t.services, prev); }
  else if (t.revert) { t.revertFn = () => t.revert; }
}

// Проверка состояния всех оптимизаций за один запуск PowerShell
async function checkAll() {
  const parts = ["$r=@{};"];
  for (const t of META.TWEAKS) {
    const im = IMPL[t.id];
    if (!im || im.stateOnly || im.run) continue;
    if (im.choice) continue;
    parts.push(`try{$r[${q(t.id)}]=[bool](& {${im.check}})}catch{$r[${q(t.id)}]=$false};`);
  }
  parts.push("$p=(powercfg /getactivescheme) -join ' ';$r['_plan']=$p;$r['_laptop']=[bool](Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue);$r|ConvertTo-Json -Compress");
  const res = await ps(parts.join(''), 120000);
  let map = {};
  try { map = JSON.parse(res.out); } catch (e) {}
  return { map, ok: res.ok, err: res.err };
}

async function applyOne(id, state) {
  const t = META.TWEAKS.find((x) => x.id === id), im = IMPL[id];
  if (!t || !im) return { ok: false, msg: 'Неизвестная оптимизация' };
  if (im.run) { const r = await ps(im.run); return { ok: r.ok, msg: r.ok ? (r.out || 'Готово') : r.err, action: true }; }
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
  const im = IMPL[id];
  if (!im) return { ok: false, msg: 'Неизвестная оптимизация' };
  if (im.choice) { const r = await ps(`powercfg /setactive ${GUID.plan_bal}`); return { ok: r.ok, msg: r.ok ? 'Готово' : r.err }; }
  if (!im.revertFn) return { ok: false, msg: 'Нечего откатывать' };
  const r = await ps(im.revertFn(prev));
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
  const i = String(id).indexOf('|'); const src = id.slice(0, i), name = id.slice(i + 1);
  if (!APPR[src]) return { ok: false, msg: 'Неизвестный пункт' };
  const bytes = (enabled ? [2] : [3]).concat([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).join(',');
  const r = await ps(`$k=${q(APPR[src])};if(-not(Test-Path $k)){New-Item -Path $k -Force|Out-Null};Set-ItemProperty -Path $k -Name ${q(name)} -Value ([byte[]](${bytes})) -Type Binary -Force;'ok'`);
  return { ok: r.ok, msg: r.ok ? 'Готово' : r.err };
}

// ---- очистка ----
const CLEAN = [
  { id: 'temp_user', title: 'Временные файлы пользователя', path: '$env:TEMP' },
  { id: 'temp_win', title: 'Временные файлы Windows', path: "'C:\\Windows\\Temp'" },
  { id: 'wu_cache', title: 'Кэш обновлений Windows', path: "'C:\\Windows\\SoftwareDistribution\\Download'" },
  { id: 'dx', title: 'Кэш шейдеров DirectX', path: "(Join-Path $env:LOCALAPPDATA 'D3DSCache')" },
  { id: 'edge', title: 'Кэш браузера Edge', path: "(Join-Path $env:LOCALAPPDATA 'Microsoft\\Edge\\User Data\\Default\\Cache')" },
  { id: 'chrome', title: 'Кэш браузера Chrome', path: "(Join-Path $env:LOCALAPPDATA 'Google\\Chrome\\User Data\\Default\\Cache')" },
  { id: 'recycle', title: 'Корзина', recycle: true },
];
async function cleanScan() {
  const lines = CLEAN.map((c) => c.recycle
    ? `try{$sh=New-Object -ComObject Shell.Application;$n=0;foreach($i in $sh.NameSpace(0xA).Items()){$n+=[double]$i.Size};$r[${q(c.id)}]=$n}catch{$r[${q(c.id)}]=0};`
    : `try{$p=${c.path};if(Test-Path $p){$r[${q(c.id)}]=[double](Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum}else{$r[${q(c.id)}]=0}}catch{$r[${q(c.id)}]=0};`).join('');
  const r = await ps(`$r=@{};${lines}$r|ConvertTo-Json -Compress`, 180000);
  let m = {}; try { m = JSON.parse(r.out); } catch (e) {}
  return { ok: r.ok, items: CLEAN.map((c) => ({ id: c.id, title: c.title, size: Number(m[c.id]) || 0 })) };
}
async function cleanRun(ids) {
  const sel = CLEAN.filter((c) => ids.includes(c.id));
  const lines = sel.map((c) => c.recycle
    ? `try{Clear-RecycleBin -Force -ErrorAction SilentlyContinue}catch{};`
    : `try{$p=${c.path};if(Test-Path $p){Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue}}catch{};`).join('');
  const r = await ps(`${lines}'ok'`, 240000);
  return { ok: r.ok };
}

async function createRestorePoint() {
  const r = await ps("Enable-ComputerRestore -Drive $env:SystemDrive -ErrorAction SilentlyContinue;Checkpoint-Computer -Description '5VINCI Optimizer' -RestorePointType MODIFY_SETTINGS;'ok'", 120000);
  return { ok: r.ok, msg: r.ok ? 'Точка восстановления создана' : 'Windows не дала создать точку (она создаётся не чаще раза в сутки или защита системы выключена)' };
}

module.exports = { META, IMPL, ps, checkAll, applyOne, revertOne, startupList, startupSet, cleanScan, cleanRun, createRestorePoint, GUID };
