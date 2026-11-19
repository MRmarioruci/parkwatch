import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';

import { since, type Box, type Pt, type Spot, type Track } from '@/lib/spots';
import { getSettings, updateSettings, useSettings } from '@/lib/store';
import { useWatcher } from '@/lib/watcher';
import { Btn, Chip, Icon, Panel, SectionTitle, Tx } from '@/ui/kit';
import { C, F, GUTTER, R, RGB } from '@/ui/theme';

type Mode = 'idle' | 'drawing';

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function Home() {
  const [permission, requestPermission] = useCameraPermissions();
  if (!permission) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  if (!permission.granted) return <AskCamera canAsk={permission.canAskAgain} onAsk={requestPermission} />;
  return <Watch />;
}

function Watch() {
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const { spots } = settings;
  const camera = useRef<CameraView>(null);
  const [camReady, setCamReady] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [blackout, setBlackout] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const w = useWatcher(camera, spots);

  // Keep "for 4 min" and "checked 10 s ago" fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const drawing = mode === 'drawing';
  const known = w.watching && spots.length > 0 && spots.every((s) => w.tracks[s.id] && w.tracks[s.id].state !== 'unknown');
  const free = spots.filter((s) => w.tracks[s.id]?.state === 'free').length;

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  }

  function onTap(e: GestureResponderEvent) {
    if (!drawing || !size.w) return;
    const x = Math.min(1, Math.max(0, e.nativeEvent.locationX / size.w));
    const y = Math.min(1, Math.max(0, e.nativeEvent.locationY / size.h));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setDraft((d) => [...d, [x, y]]);
  }

  function saveSpot() {
    if (draft.length < 3) return;
    const spot: Spot = { id: newId(), name: `Spot ${spots.length + 1}`, pts: draft };
    updateSettings({ spots: [...spots, spot] });
    setDraft([]);
    setMode('idle');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setToast(`${spot.name} saved. Tap its name to rename it.`);
  }

  async function startWatching() {
    if (!settings.topic.trim()) setToast('Tip: set your ntfy topic in Settings to get alerts');
    await w.start();
  }

  async function runTest() {
    const found = await w.test();
    if (found) setToast(found.length ? `Sees ${found.length} vehicle${found.length > 1 ? 's' : ''}. Check the boxes line up with the cars.` : 'No vehicles seen around your spots');
  }

  // ---------- hero ----------
  let eyebrow = 'Blue zone';
  let big = 'Not watching';
  let sub = 'Mark the parking spaces you care about, then start watching.';
  if (known) {
    eyebrow = 'Right now';
    sub = w.lastCheck ? `Checked ${since(w.lastCheck, now) === '<1 min' ? 'just now' : `${since(w.lastCheck, now)} ago`} · every ${settings.interval}s` : '';
  } else if (w.watching) {
    big = 'Looking…';
    sub = `Confirming each spot over ${settings.confirm} checks.`;
  } else if (drawing) {
    big = 'Mark a spot';
    sub = 'Tap the corners of one parking space on the road.';
  } else if (!spots.length) {
    big = 'Mark a spot';
    sub = 'Point the phone at the street and tap “Add spot”.';
  } else {
    big = 'Ready';
    sub = `${spots.length} spot${spots.length > 1 ? 's' : ''} marked. Tap Start watching.`;
  }

  const status = w.watching ? { text: 'Watching', color: C.free } : camReady ? { text: 'Ready', color: C.faint } : { text: 'Starting camera', color: C.wait };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" hidden={blackout} />
      <ScrollView scrollEnabled={!drawing} contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 120 }}>
        {/* app bar */}
        <View style={s.bar}>
          <View style={s.brand}>
            <View style={s.logo}>
              <Tx style={s.logoP}>P</Tx>
            </View>
            <Tx style={{ fontFamily: F.bold, fontSize: 17, letterSpacing: -0.2 }}>ParkWatch</Tx>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Chip text={status.text} color={status.color} />
            <Pressable accessibilityLabel="Settings" hitSlop={8} onPress={() => router.push('/settings')} style={s.gear}>
              <Icon name="gear" size={19} color={C.mute} />
            </Pressable>
          </View>
        </View>

        {/* hero */}
        <View style={{ marginBottom: 18, marginHorizontal: 2 }}>
          <Tx style={s.eyebrow}>{eyebrow}</Tx>
          {known ? (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
              <Tx style={[s.num, { color: free ? C.free : C.text }]}>{free}</Tx>
              <Tx style={s.of}>/ {spots.length}</Tx>
              <Tx style={{ fontSize: 16, color: C.mute }}>{free === 1 ? 'spot free' : 'spots free'}</Tx>
            </View>
          ) : (
            <Tx style={s.bigIdle}>{big}</Tx>
          )}
          <Tx style={s.sub}>{sub}</Tx>
        </View>

        {/* camera */}
        <View style={s.cam} onLayout={onLayout}>
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" ratio="4:3" animateShutter={false} onCameraReady={() => setCamReady(true)} />
          {!settings.showPreview && !drawing && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#07090d' }]} />}
          <Overlay size={size} spots={spots} tracks={w.tracks} watching={w.watching} boxes={settings.showBoxes || drawing ? w.boxes : []} draft={drawing ? draft : []} />
          <Pressable style={StyleSheet.absoluteFill} onPress={onTap} disabled={!drawing} accessibilityLabel={drawing ? 'Tap a corner of the parking space' : undefined} />
          <View style={s.tag} pointerEvents="none">
            <View style={[s.dot, { backgroundColor: w.watching ? C.free : drawing ? C.blue : C.faint }]} />
            <Tx style={s.tagText}>{drawing ? 'MARKING SPOT' : w.watching ? `WATCHING${settings.showPreview ? '' : ' · PREVIEW OFF'}` : settings.showPreview ? 'LIVE' : 'PREVIEW OFF'}</Tx>
            {w.checking && <ActivityIndicator size="small" color={C.mute} style={{ transform: [{ scale: 0.7 }], marginLeft: -2, marginRight: -6 }} />}
          </View>
          {drawing && (
            <View style={s.hint} pointerEvents="none">
              <Tx style={{ fontSize: 13.5, fontFamily: F.medium }}>
                {draft.length < 3 ? (
                  <>
                    Tap the <Tx style={{ fontFamily: F.bold, fontSize: 13.5 }}>corners</Tx> of the space on the road · {draft.length}/3
                  </>
                ) : (
                  <>
                    <Tx style={{ fontFamily: F.bold, fontSize: 13.5 }}>{draft.length} corners</Tx> · tap Save, or keep adding
                  </>
                )}
              </Tx>
            </View>
          )}
        </View>

        {/* spots */}
        <SectionTitle title="Spots" right={spots.length ? `${spots.length} marked` : undefined} />
        <Panel>
          {spots.length === 0 ? (
            <View style={{ padding: 26, alignItems: 'center' }}>
              <Tx style={{ fontFamily: F.semibold, marginBottom: 4 }}>No spots yet</Tx>
              <Tx style={{ color: C.mute, fontSize: 14, textAlign: 'center' }}>Tap “Add spot” below, then tap the corners of a parking space on the camera image.</Tx>
            </View>
          ) : (
            spots.map((spot, i) => <SpotRow key={spot.id} spot={spot} first={i === 0} track={w.watching ? w.tracks[spot.id] : undefined} watching={w.watching} occ={settings.occ} now={now} />)
          )}
        </Panel>

        {!w.watching && spots.length > 0 && (
          <Pressable onPress={runTest} disabled={w.checking || !camReady} style={s.testRow}>
            <Icon name="target" size={18} color={C.blueText} />
            <View style={{ flex: 1 }}>
              <Tx style={{ fontFamily: F.semibold, fontSize: 14.5, color: C.blueText }}>Test detection</Tx>
              <Tx style={{ fontSize: 12.5, color: C.mute }}>One check now, to see what the camera picks up</Tx>
            </View>
            {w.checking && <ActivityIndicator color={C.blueText} />}
          </Pressable>
        )}

        {/* activity */}
        {w.log.length > 0 && (
          <>
            <SectionTitle title="Activity" />
            <Panel style={{ padding: 14, gap: 6 }}>
              {w.log.slice(0, 12).map((l) => (
                <View key={`${l.at}-${l.text}`} style={{ flexDirection: 'row', gap: 10 }}>
                  <Tx style={s.logTime}>{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Tx>
                  <Tx style={{ flex: 1, fontSize: 13, color: C.mute }}>{l.text}</Tx>
                </View>
              ))}
            </Panel>
          </>
        )}

        <View style={s.note}>
          <Icon name="lock" size={14} color={C.faint} />
          <Tx style={{ flex: 1, fontSize: 12.5, color: C.faint }}>Each check is a still image analysed on this phone and deleted straight after. Nothing is recorded or uploaded, only the text of each alert.</Tx>
        </View>
      </ScrollView>

      {/* dock */}
      <View style={[s.dock, { paddingBottom: insets.bottom + 14 }]}>
        {drawing ? (
          <>
            <Btn icon="undo" onPress={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length} />
            <Btn
              title="Cancel"
              onPress={() => {
                setDraft([]);
                setMode('idle');
              }}
            />
            <Btn title="Save spot" kind="ok" onPress={saveSpot} disabled={draft.length < 3} />
          </>
        ) : w.watching ? (
          <>
            <Btn title="Stop watching" kind="stop" onPress={w.stop} />
            <Btn icon="moon" onPress={() => setBlackout(true)} />
          </>
        ) : (
          <>
            <Btn
              title="Add spot"
              icon="plus"
              onPress={() => {
                w.clearBoxes();
                setDraft([]);
                setMode('drawing');
              }}
              disabled={!camReady}
            />
            <Btn title="Start watching" kind="primary" onPress={startWatching} disabled={!spots.length || !camReady} />
          </>
        )}
      </View>

      {toast && (
        <View style={[s.toast, { bottom: insets.bottom + 92 }]} pointerEvents="none">
          <Tx style={{ color: C.bg, fontFamily: F.semibold, fontSize: 14, textAlign: 'center' }}>{toast}</Tx>
        </View>
      )}

      {blackout && (
        <Pressable style={s.blackout} onPress={() => setBlackout(false)}>
          <Tx style={{ fontFamily: F.display, fontSize: 34, color: free ? '#12402c' : '#2a1c1c' }}>{known ? `${free}/${spots.length}` : '–'}</Tx>
          <Tx style={{ fontSize: 12, color: '#24272e' }}>watching · tap to wake</Tx>
        </Pressable>
      )}
    </View>
  );
}

function Overlay({ size, spots, tracks, watching, boxes, draft }: { size: { w: number; h: number }; spots: Spot[]; tracks: Record<string, Track>; watching: boolean; boxes: Box[]; draft: Pt[] }) {
  const { w, h } = size;
  if (!w) return null;
  const pts = (p: Pt[]) => p.map(([x, y]) => `${x * w},${y * h}`).join(' ');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={w} height={h}>
        {boxes.map((b, i) => {
          const x = b.x * w;
          const y = b.y * h;
          const bw = b.w * w;
          const bh = b.h * h;
          const l = Math.min(bw, bh) * 0.25;
          const d = `M${x},${y + l}V${y}H${x + l} M${x + bw - l},${y}H${x + bw}V${y + l} M${x + bw},${y + bh - l}V${y + bh}H${x + bw - l} M${x + l},${y + bh}H${x}V${y + bh - l}`;
          return <Path key={`b${i}`} d={d} stroke="rgba(143,176,255,0.95)" strokeWidth={2} strokeLinecap="round" fill="none" />;
        })}
        {spots.map((spot) => {
          const state = watching ? (tracks[spot.id]?.state ?? 'unknown') : 'idle';
          const c = RGB[state === 'unknown' ? 'unknown' : state];
          return <Polygon key={spot.id} points={pts(spot.pts)} fill={`rgba(${c},${watching ? 0.22 : 0.1})`} stroke={`rgba(${c},0.95)`} strokeWidth={2} strokeLinejoin="round" />;
        })}
        {draft.length > 0 && (
          <>
            {draft.length > 2 && <Polygon points={pts(draft)} fill="rgba(47,107,255,0.18)" stroke="none" />}
            {draft.map(([x, y], i) => {
              const next = draft[i + 1] ?? (draft.length > 2 ? draft[0] : null);
              return next ? <Line key={`l${i}`} x1={x * w} y1={y * h} x2={next[0] * w} y2={next[1] * h} stroke="#fff" strokeWidth={2} strokeDasharray="7 5" /> : null;
            })}
            {draft.map(([x, y], i) => (
              <Circle key={`c${i}`} cx={x * w} cy={y * h} r={9} fill="rgba(47,107,255,0.35)" />
            ))}
            {draft.map(([x, y], i) => (
              <Circle key={`d${i}`} cx={x * w} cy={y * h} r={5} fill={i === 0 ? C.blue : '#fff'} />
            ))}
          </>
        )}
      </Svg>
      {spots.map((spot) => {
        const cx = (spot.pts.reduce((a, p) => a + p[0], 0) / spot.pts.length) * w;
        const cy = (spot.pts.reduce((a, p) => a + p[1], 0) / spot.pts.length) * h;
        const state = watching ? (tracks[spot.id]?.state ?? 'unknown') : 'idle';
        return (
          <View key={`t${spot.id}`} style={[s.spotPill, { left: cx - 60, top: cy - 12 }]}>
            <View style={s.spotPillInner}>
              <View style={[s.dot, { width: 7, height: 7, backgroundColor: `rgb(${RGB[state]})` }]} />
              <Tx numberOfLines={1} style={{ fontSize: 12, fontFamily: F.semibold, color: '#fff' }}>
                {spot.name}
              </Tx>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SpotRow({ spot, first, track, watching, occ, now }: { spot: Spot; first: boolean; track?: Track; watching: boolean; occ: number; now: number }) {
  const [name, setName] = useState(spot.name);
  const state = watching ? (track?.state ?? 'unknown') : 'idle';
  const rail = { free: C.free, occupied: C.taken, unknown: C.wait, idle: C.surface2 }[state];
  const label = { free: 'Free', occupied: 'Taken', unknown: 'Checking', idle: 'Idle' }[state];
  const color = { free: C.free, occupied: C.taken, unknown: C.wait, idle: C.faint }[state];
  const ratio = track?.ratio ?? 0;

  function commit() {
    const n = name.trim() || spot.name;
    setName(n);
    if (n !== spot.name) updateSettings({ spots: getSettings().spots.map((s) => (s.id === spot.id ? { ...s, name: n } : s)) });
  }

  return (
    <View style={[s.spot, !first && { borderTopWidth: 1, borderTopColor: C.hair }]}>
      <View style={[s.rail, { backgroundColor: rail }, state === 'free' && { shadowColor: C.free, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 }]} />
      <View style={{ flex: 1 }}>
        <TextInput value={name} onChangeText={setName} onEndEditing={commit} onSubmitEditing={commit} style={s.name} selectionColor={C.blue} returnKeyType="done" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <Tx style={{ fontSize: 12, fontFamily: F.bold, letterSpacing: 0.5, textTransform: 'uppercase', color }}>{label}</Tx>
          {watching && (
            <View style={s.meter}>
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(ratio * 100)}%`, backgroundColor: ratio >= occ ? C.taken : C.free, borderRadius: 4 }} />
              <View style={{ position: 'absolute', top: -2, bottom: -2, width: 2, left: `${Math.round(occ * 100)}%`, backgroundColor: 'rgba(255,255,255,0.35)' }} />
            </View>
          )}
          {watching && track?.since ? <Tx style={{ fontSize: 12.5, color: C.mute }}>for {since(track.since, now)}</Tx> : null}
        </View>
      </View>
      {!watching && (
        <Pressable
          accessibilityLabel={`Delete ${spot.name}`}
          hitSlop={6}
          onPress={() => updateSettings({ spots: getSettings().spots.filter((s) => s.id !== spot.id) })}
          style={s.iconBtn}
        >
          <Icon name="trash" size={18} color={C.faint} />
        </Pressable>
      )}
    </View>
  );
}

function AskCamera({ canAsk, onAsk }: { canAsk: boolean; onAsk: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, padding: 24, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24, justifyContent: 'space-between' }}>
      <View style={s.logo}>
        <Tx style={s.logoP}>P</Tx>
      </View>
      <View style={{ gap: 12 }}>
        <Tx style={{ fontFamily: F.display, fontSize: 34, letterSpacing: -1, lineHeight: 38 }}>Know when a spot opens up.</Tx>
        <Tx style={{ color: C.mute, lineHeight: 22 }}>
          ParkWatch looks at the parking spaces you mark and pings your phone when one is free. It needs the camera for that. Images are analysed on this phone and deleted right away.
        </Tx>
      </View>
      <Btn title={canAsk ? 'Allow camera' : 'Allow camera in Android settings'} kind="primary" onPress={onAsk} style={{ flex: 0 }} />
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 34, height: 34, borderRadius: 9, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
  logoP: { fontFamily: F.display, fontSize: 18, color: '#fff', lineHeight: 22 },
  gear: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.hair },
  eyebrow: { fontSize: 12, fontFamily: F.semibold, letterSpacing: 1, textTransform: 'uppercase', color: C.mute },
  num: { fontFamily: F.display, fontSize: 64, lineHeight: 70, letterSpacing: -2 },
  of: { fontFamily: F.displayMedium, fontSize: 26, color: C.faint },
  bigIdle: { fontFamily: F.display, fontSize: 32, lineHeight: 40, letterSpacing: -0.8, marginTop: 4 },
  sub: { color: C.mute, fontSize: 13.5, marginTop: 6 },
  cam: { width: '100%', aspectRatio: 3 / 4, borderRadius: R, overflow: 'hidden', backgroundColor: '#05070a', borderWidth: 1, borderColor: C.hair },
  tag: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: 'rgba(10,12,17,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  tagText: { fontSize: 11, fontFamily: F.semibold, letterSpacing: 0.6 },
  dot: { width: 6, height: 6, borderRadius: 4 },
  hint: { position: 'absolute', left: 12, right: 12, bottom: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(10,12,17,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  spotPill: { position: 'absolute', width: 120, alignItems: 'center' },
  spotPillInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: 'rgba(10,12,17,0.78)', maxWidth: 120 },
  spot: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingRight: 8 },
  rail: { width: 4, alignSelf: 'stretch', borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  name: { color: C.text, fontFamily: F.semibold, fontSize: 15.5, padding: 0 },
  meter: { flex: 1, maxWidth: 110, height: 4, borderRadius: 4, backgroundColor: C.surface2 },
  iconBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  testRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, padding: 14, borderRadius: R, backgroundColor: C.blueSoft },
  logTime: { fontSize: 12, color: C.faint, fontFamily: F.medium, width: 42 },
  note: { flexDirection: 'row', gap: 8, marginTop: 22, marginHorizontal: 6 },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: GUTTER, paddingTop: 14, backgroundColor: 'rgba(10,12,17,0.94)', borderTopWidth: 1, borderTopColor: C.hair },
  toast: { position: 'absolute', alignSelf: 'center', maxWidth: '88%', backgroundColor: C.text, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  blackout: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 10 },
});
