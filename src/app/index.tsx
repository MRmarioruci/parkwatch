import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

import { AI_MODELS } from '@/lib/ai';
import { useApiKey } from '@/lib/secrets';
import { since, splitQuad, type Box, type Pt, type Spot, type Track } from '@/lib/spots';
import { getSettings, updateSettings, usageToday, useSettings } from '@/lib/store';
import { useWatcher } from '@/lib/watcher';
import { Btn, Icon, Tx } from '@/ui/kit';
import { C, F, GUTTER, R, RGB } from '@/ui/theme';

type Mode = 'idle' | 'drawing';

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const HIDE_AFTER = 5000;

export default function Home() {
  const [permission, requestPermission] = useCameraPermissions();
  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!permission.granted) return <AskCamera canAsk={permission.canAskAgain} onAsk={requestPermission} />;
  return <Watch />;
}

function Watch() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const settings = useSettings();
  const apiKey = useApiKey();
  const { spots } = settings;
  const camera = useRef<CameraView>(null);
  const [camReady, setCamReady] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [parts, setParts] = useState(1);
  const [sheet, setSheet] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const [uiOn, setUiOn] = useState(true);
  const [poked, setPoked] = useState(0);
  // Animated values live in state (stable for the component's life) rather than a ref read in render.
  const [fade] = useState(() => new Animated.Value(1));
  const [fadeOut] = useState(() => fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }));
  const w = useWatcher(camera, spots);

  const drawing = mode === 'drawing';
  const ai = settings.useAI && !!apiKey;
  const usage = usageToday(settings);

  // The whole 4:3 frame, as large as the screen allows, centred. Everything else floats on top.
  const camW = Math.min(W, (H * 3) / 4);
  const camH = (camW * 4) / 3;
  const camLeft = (W - camW) / 2;
  const camTop = Math.max(0, (H - camH) / 2);

  // Controls fade out while watching and come back on touch.
  const autoHide = w.watching && !sheet && !drawing && !blackout;
  const shown = uiOn || !autoHide;
  useEffect(() => {
    Animated.timing(fade, { toValue: shown ? 1 : 0, duration: 260, useNativeDriver: true }).start();
  }, [shown, fade]);
  useEffect(() => {
    if (!autoHide || !uiOn) return;
    const t = setTimeout(() => setUiOn(false), HIDE_AFTER);
    return () => clearTimeout(t);
  }, [autoHide, uiOn, poked]);
  const poke = () => {
    setUiOn(true);
    setPoked((n) => n + 1);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const known = w.watching && spots.length > 0 && spots.every((s) => w.tracks[s.id] && w.tracks[s.id].state !== 'unknown');
  const free = spots.filter((s) => w.tracks[s.id]?.state === 'free').length;
  const split = draft.length === 4 && parts > 1;

  function onCameraTap(e: GestureResponderEvent) {
    if (drawing) {
      const x = Math.min(1, Math.max(0, e.nativeEvent.locationX / camW));
      const y = Math.min(1, Math.max(0, e.nativeEvent.locationY / camH));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setDraft((d) => [...d, [x, y]]);
      return;
    }
    if (autoHide && shown) setUiOn(false);
    else poke();
  }

  function saveSpot() {
    if (draft.length < 3) return;
    const areas = split ? splitQuad(draft, parts, camW / camH) : [draft];
    const made: Spot[] = areas.map((pts, k) => ({ id: newId() + k, name: `Spot ${spots.length + k + 1}`, pts }));
    updateSettings({ spots: [...spots, ...made] });
    setDraft([]);
    setParts(1);
    setMode('idle');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setToast(made.length > 1 ? `${made.length} spaces saved` : `${made[0].name} saved`);
  }

  async function startWatching() {
    if (!settings.topic.trim()) setToast('Set your ntfy topic in Settings to get alerts');
    else if (settings.useAI && !apiKey) setToast('No Claude API key yet: using the on-phone detector');
    setSheet(false);
    await w.start();
    poke();
  }

  async function runTest() {
    const msg = await w.test();
    if (msg) setToast(msg);
  }

  // ---------- hero text ----------
  let eyebrow = 'Blue zone';
  let big = 'Not watching';
  let sub = 'Mark the parking spaces you care about, then start watching.';
  if (known) {
    eyebrow = 'Right now';
    sub = w.lastCheck ? `Checked ${since(w.lastCheck, now) === '<1 min' ? 'just now' : `${since(w.lastCheck, now)} ago`} · ${ai ? 'Claude' : 'on the phone'}` : '';
  } else if (w.watching) {
    big = 'Looking…';
    sub = ai ? `Asking ${AI_MODELS[settings.aiModel]?.label ?? 'Claude'} every ${settings.aiInterval}s` : `Confirming each spot over ${settings.confirm} checks`;
  } else if (drawing) {
    big = 'Mark a spot';
    sub = draft.length < 3 ? `Tap the corners of a parking space · ${draft.length}/3` : `${draft.length} corners · Save, or keep adding`;
  } else if (!spots.length) {
    big = 'Mark a spot';
    sub = 'Tap “Add spot”, then tap the corners of a parking space.';
  } else {
    big = 'Ready';
    sub = `${spots.length} space${spots.length > 1 ? 's' : ''} · ${ai ? 'checked by Claude' : 'checked on the phone'}`;
  }

  const status = w.watching ? { text: ai ? 'Watching · AI' : 'Watching', color: C.free } : camReady ? { text: 'Ready', color: C.faint } : { text: 'Starting', color: C.wait };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" hidden={blackout || !shown} />

      {/* camera: the whole frame, tappable */}
      <View style={{ position: 'absolute', left: camLeft, top: camTop, width: camW, height: camH }}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" ratio="4:3" animateShutter={false} onCameraReady={() => setCamReady(true)} />
        {!settings.showPreview && !drawing && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#07090d' }]} />}
        <Overlay w={camW} h={camH} spots={spots} tracks={w.tracks} watching={w.watching} boxes={settings.showBoxes || drawing ? w.boxes : []} draft={drawing ? draft : []} parts={split ? parts : 1} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onCameraTap} accessibilityLabel={drawing ? 'Tap a corner of the parking space' : 'Show or hide controls'} />
      </View>

      {/* minimal status while the controls are hidden */}
      <Animated.View pointerEvents="none" style={[st.mini, { top: insets.top + 12, opacity: fadeOut }]}>
        <View style={[st.dot, { backgroundColor: free ? C.free : known ? C.taken : C.wait }]} />
        <Tx style={{ fontFamily: F.semibold, fontSize: 13 }}>{known ? `${free}/${spots.length} free` : 'Looking…'}</Tx>
        {w.checking && <ActivityIndicator size="small" color={C.mute} style={{ transform: [{ scale: 0.7 }], marginRight: -6 }} />}
      </Animated.View>

      {/* top: brand, status, settings, hero */}
      <Animated.View pointerEvents={shown ? 'box-none' : 'none'} style={[st.top, { opacity: fade }]}>
        <Scrim height={insets.top + 190} from="top" />
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: GUTTER }} pointerEvents="box-none">
          <View style={st.bar}>
            <View style={st.brand}>
              <View style={st.logo}>
                <Tx style={st.logoP}>P</Tx>
              </View>
              <Tx style={{ fontFamily: F.bold, fontSize: 17, letterSpacing: -0.2 }}>ParkWatch</Tx>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Glass style={st.chip}>
                <View style={[st.dot, { backgroundColor: status.color }]} />
                <Tx style={{ fontSize: 12.5, fontFamily: F.medium }}>{status.text}</Tx>
                {w.checking && <ActivityIndicator size="small" color={C.mute} style={{ transform: [{ scale: 0.7 }], marginRight: -6 }} />}
              </Glass>
              <Pressable accessibilityLabel="Settings" hitSlop={8} onPress={() => router.push('/settings')} disabled={drawing}>
                <Glass style={st.round}>
                  <Icon name="gear" size={19} color={drawing ? C.faint : C.text} />
                </Glass>
              </Pressable>
            </View>
          </View>
          <View style={{ marginTop: 14 }} pointerEvents="none">
            <Tx style={st.eyebrow}>{eyebrow}</Tx>
            {known ? (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Tx style={[st.num, { color: free ? C.free : C.text }]}>{free}</Tx>
                <Tx style={st.of}>/ {spots.length}</Tx>
                <Tx style={{ fontSize: 15, color: C.mute }}>{free === 1 ? 'space free' : 'spaces free'}</Tx>
              </View>
            ) : (
              <Tx style={st.bigIdle}>{big}</Tx>
            )}
            <Tx style={st.sub}>{sub}</Tx>
          </View>
        </View>
      </Animated.View>

      {/* bottom: spot chips, parts picker, actions */}
      <Animated.View pointerEvents={shown ? 'box-none' : 'none'} style={[st.bottom, { opacity: fade }]}>
        <Scrim height={insets.bottom + 210} from="bottom" />
        <View style={{ paddingBottom: insets.bottom + 14, gap: 12 }} pointerEvents="box-none">
          {drawing && draft.length === 4 && (
            <Glass style={[st.partsBar, { marginHorizontal: GUTTER }]}>
              <View style={{ flex: 1 }}>
                <Tx style={{ fontFamily: F.semibold, fontSize: 14 }}>Cars that fit here</Tx>
                <Tx style={{ fontSize: 12, color: C.mute }}>{parts > 1 ? `Saved as ${parts} separate spaces` : 'A strip of several? Add more.'}</Tx>
              </View>
              <View style={st.stepper}>
                <Pressable accessibilityLabel="Fewer spaces" onPress={() => setParts((n) => Math.max(1, n - 1))} hitSlop={4} style={st.stepBtn}>
                  <Icon name="minus" size={16} color={C.mute} />
                </Pressable>
                <Tx style={{ minWidth: 28, textAlign: 'center', fontFamily: F.display, fontSize: 18 }}>{parts}</Tx>
                <Pressable accessibilityLabel="More spaces" onPress={() => setParts((n) => Math.min(8, n + 1))} hitSlop={4} style={st.stepBtn}>
                  <Icon name="plus" size={16} color={C.mute} />
                </Pressable>
              </View>
            </Glass>
          )}

          {!drawing && spots.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 8 }}>
              {spots.map((spot) => {
                const state = w.watching ? (w.tracks[spot.id]?.state ?? 'unknown') : 'idle';
                return (
                  <Pressable
                    key={spot.id}
                    onPress={() => {
                      setSheet(true);
                      poke();
                    }}
                  >
                    <Glass style={st.spotChip}>
                      <View style={[st.dot, { width: 8, height: 8, backgroundColor: `rgb(${RGB[state]})` }]} />
                      <Tx style={{ fontFamily: F.semibold, fontSize: 13.5 }}>{spot.name}</Tx>
                      {w.watching && <Tx style={{ fontSize: 12.5, color: C.mute }}>{{ free: 'free', occupied: 'taken', unknown: '…', idle: '' }[state]}</Tx>}
                    </Glass>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={st.dock}>
            {drawing ? (
              <>
                <Btn icon="undo" onPress={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length} />
                <Btn
                  title="Cancel"
                  onPress={() => {
                    setDraft([]);
                    setParts(1);
                    setMode('idle');
                  }}
                />
                <Btn title={split ? `Save ${parts}` : 'Save spot'} kind="ok" onPress={saveSpot} disabled={draft.length < 3} />
              </>
            ) : w.watching ? (
              <>
                <Btn icon="list" onPress={() => setSheet(true)} />
                <Btn title="Stop watching" kind="stop" onPress={w.stop} />
                <Btn icon="moon" onPress={() => setBlackout(true)} />
              </>
            ) : (
              <>
                <Btn icon="list" onPress={() => setSheet(true)} disabled={!spots.length} />
                <Btn
                  title="Add spot"
                  icon="plus"
                  onPress={() => {
                    w.clearBoxes();
                    setDraft([]);
                    setParts(1);
                    setSheet(false);
                    setMode('drawing');
                  }}
                  disabled={!camReady}
                />
                <Btn title="Start" kind="primary" onPress={startWatching} disabled={!spots.length || !camReady} />
              </>
            )}
          </View>
        </View>
      </Animated.View>

      {/* spots & activity sheet */}
      {sheet && (
        <>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} onPress={() => setSheet(false)} accessibilityLabel="Close" />
          <View style={[st.sheet, { paddingBottom: insets.bottom + 16, maxHeight: H * 0.72 }]}>
            <View style={st.handle} />
            <View style={st.sheetHead}>
              <Tx style={{ fontFamily: F.bold, fontSize: 17 }}>Spaces</Tx>
              <Tx style={{ fontSize: 12.5, color: C.mute }}>{ai ? `Claude · ${usage.calls} checks today · $${usage.cost.toFixed(2)}` : 'On-phone detector'}</Tx>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
              <View style={st.panel}>
                {spots.map((spot, i) => (
                  <SpotRow
                    key={spot.id}
                    spot={spot}
                    first={i === 0}
                    track={w.tracks[spot.id]}
                    watching={w.watching}
                    occ={settings.occ}
                    now={now}
                    ai={ai}
                    onCorrect={(state) => {
                      w.mark(spot, state);
                      setToast(`${spot.name} marked ${state === 'free' ? 'free' : 'taken'}`);
                    }}
                  />
                ))}
              </View>

              {!w.watching && (
                <Pressable onPress={runTest} disabled={w.checking || !camReady} style={st.testRow}>
                  <Icon name="target" size={18} color={C.blueText} />
                  <View style={{ flex: 1 }}>
                    <Tx style={{ fontFamily: F.semibold, fontSize: 14.5, color: C.blueText }}>{ai ? 'Ask Claude now' : 'Test detection'}</Tx>
                    <Tx style={{ fontSize: 12.5, color: C.mute }}>{ai ? 'One AI check, to see what it makes of your spaces' : 'One check now, to see what the camera picks up'}</Tx>
                  </View>
                  {w.checking && <ActivityIndicator color={C.blueText} />}
                </Pressable>
              )}

              {w.log.length > 0 && (
                <>
                  <Tx style={st.sheetLabel}>Activity</Tx>
                  <View style={[st.panel, { padding: 14, gap: 6 }]}>
                    {w.log.slice(0, 20).map((l) => (
                      <View key={`${l.at}-${l.text}`} style={{ flexDirection: 'row', gap: 10 }}>
                        <Tx style={st.logTime}>{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Tx>
                        <Tx style={{ flex: 1, fontSize: 13, color: C.mute }}>{l.text}</Tx>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </>
      )}

      {toast && (
        <View style={[st.toast, { bottom: insets.bottom + 150 }]} pointerEvents="none">
          <Tx style={{ color: C.bg, fontFamily: F.semibold, fontSize: 14, textAlign: 'center' }}>{toast}</Tx>
        </View>
      )}

      {blackout && (
        <Pressable style={st.blackout} onPress={() => setBlackout(false)}>
          <Tx style={{ fontFamily: F.display, fontSize: 34, color: free ? '#12402c' : '#2a1c1c' }}>{known ? `${free}/${spots.length}` : '–'}</Tx>
          <Tx style={{ fontSize: 12, color: '#24272e' }}>watching · tap to wake</Tx>
        </Pressable>
      )}
    </View>
  );
}

/** Dark translucent surface for controls floating over the camera. */
function Glass({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[st.glass, style]}>{children}</View>;
}

/** Soft gradient behind the floating controls so they read over any picture. */
function Scrim({ height, from }: { height: number; from: 'top' | 'bottom' }) {
  const id = `scrim-${from}`;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, height, ...(from === 'top' ? { top: 0 } : { bottom: 0 }) }}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1={from === 'top' ? '0' : '1'} x2="0" y2={from === 'top' ? '1' : '0'}>
            <Stop offset="0" stopColor="#000" stopOpacity={0.78} />
            <Stop offset="0.55" stopColor="#000" stopOpacity={0.4} />
            <Stop offset="1" stopColor="#000" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

function Overlay({ w, h, spots, tracks, watching, boxes, draft, parts }: { w: number; h: number; spots: Spot[]; tracks: Record<string, Track>; watching: boolean; boxes: Box[]; draft: Pt[]; parts: number }) {
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
          const c = RGB[state];
          return <Polygon key={spot.id} points={pts(spot.pts)} fill={`rgba(${c},${watching ? 0.22 : 0.1})`} stroke={`rgba(${c},0.95)`} strokeWidth={2} strokeLinejoin="round" />;
        })}
        {draft.length > 0 && (
          <>
            {parts > 1 &&
              splitQuad(draft, parts, w / h)
                .slice(1)
                .map((q, i) => <Line key={`p${i}`} x1={q[0][0] * w} y1={q[0][1] * h} x2={q[3][0] * w} y2={q[3][1] * h} stroke={C.blueText} strokeWidth={2} />)}
            {draft.length > 2 && <Polygon points={pts(draft)} fill="rgba(47,107,255,0.18)" stroke="none" />}
            {draft.map(([x, y], i) => {
              const next = draft[i + 1] ?? (draft.length > 2 ? draft[0] : null);
              return next ? <Line key={`l${i}`} x1={x * w} y1={y * h} x2={next[0] * w} y2={next[1] * h} stroke="#fff" strokeWidth={2} strokeDasharray="7 5" /> : null;
            })}
            {draft.map(([x, y], i) => (
              <Circle key={`c${i}`} cx={x * w} cy={y * h} r={10} fill="rgba(47,107,255,0.35)" />
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
          <View key={`t${spot.id}`} style={[st.spotPill, { left: cx - 60, top: cy - 12 }]}>
            <View style={st.spotPillInner}>
              <View style={[st.dot, { width: 7, height: 7, backgroundColor: `rgb(${RGB[state]})` }]} />
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

function SpotRow({ spot, first, track, watching, occ, now, ai, onCorrect }: { spot: Spot; first: boolean; track?: Track; watching: boolean; occ: number; now: number; ai: boolean; onCorrect: (state: 'free' | 'occupied') => void }) {
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
    <View style={[st.spot, !first && { borderTopWidth: 1, borderTopColor: C.hair }]}>
      <View style={[st.rail, { backgroundColor: rail }]} />
      <View style={{ flex: 1 }}>
        <TextInput value={name} onChangeText={setName} onEndEditing={commit} onSubmitEditing={commit} style={st.name} selectionColor={C.blue} returnKeyType="done" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <Tx style={{ fontSize: 12, fontFamily: F.bold, letterSpacing: 0.5, textTransform: 'uppercase', color }}>{label}</Tx>
          {watching && !ai && (
            <View style={st.meter}>
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(ratio * 100)}%`, backgroundColor: ratio >= occ ? C.taken : C.free, borderRadius: 4 }} />
              <View style={{ position: 'absolute', top: -2, bottom: -2, width: 2, left: `${Math.round(occ * 100)}%`, backgroundColor: 'rgba(255,255,255,0.35)' }} />
            </View>
          )}
          {watching && track?.since ? <Tx style={{ fontSize: 12.5, color: C.mute }}>for {since(track.since, now)}</Tx> : null}
        </View>
        {track?.reason ? (
          <Tx style={{ fontSize: 12.5, color: C.mute, marginTop: 3 }} numberOfLines={2}>
            Claude: {track.reason}
          </Tx>
        ) : watching && track?.byLook ? (
          <Tx style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>
            {track.state === 'occupied' && track.ratio < occ ? 'Car hidden, spot looks unchanged' : 'Spot looks different'} · {Math.round((track.sim ?? 0) * 100)}% alike
          </Tx>
        ) : null}
      </View>
      {watching && (state === 'free' || state === 'occupied') && (
        <Pressable onPress={() => onCorrect(state === 'free' ? 'occupied' : 'free')} hitSlop={6} style={st.fixBtn}>
          <Tx style={{ fontSize: 12.5, fontFamily: F.semibold, color: C.mute }}>{state === 'free' ? 'It’s taken' : 'It’s free'}</Tx>
        </Pressable>
      )}
      {!watching && (
        <Pressable accessibilityLabel={`Delete ${spot.name}`} hitSlop={6} onPress={() => updateSettings({ spots: getSettings().spots.filter((s) => s.id !== spot.id) })} style={st.iconBtn}>
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
      <View style={st.logo}>
        <Tx style={st.logoP}>P</Tx>
      </View>
      <View style={{ gap: 12 }}>
        <Tx style={{ fontFamily: F.display, fontSize: 34, letterSpacing: -1, lineHeight: 38 }}>Know when a spot opens up.</Tx>
        <Tx style={{ color: C.mute, lineHeight: 22 }}>ParkWatch looks at the parking spaces you mark and pings your phone when one is free. It needs the camera for that.</Tx>
      </View>
      <Btn title={canAsk ? 'Allow camera' : 'Allow camera in Android settings'} kind="primary" onPress={onAsk} style={{ flex: 0 }} />
    </View>
  );
}

const st = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 32, height: 32, borderRadius: 9, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
  logoP: { fontFamily: F.display, fontSize: 17, color: '#fff', lineHeight: 21 },
  glass: { backgroundColor: 'rgba(18,21,28,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, height: 34, borderRadius: 17 },
  round: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  mini: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: 'rgba(10,12,17,0.6)' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  eyebrow: { fontSize: 11.5, fontFamily: F.semibold, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(238,241,246,0.7)' },
  num: { fontFamily: F.display, fontSize: 52, lineHeight: 58, letterSpacing: -2 },
  of: { fontFamily: F.displayMedium, fontSize: 22, color: 'rgba(238,241,246,0.55)' },
  bigIdle: { fontFamily: F.display, fontSize: 30, lineHeight: 38, letterSpacing: -0.8, marginTop: 2 },
  sub: { color: 'rgba(238,241,246,0.75)', fontSize: 13.5, marginTop: 4 },
  spotPill: { position: 'absolute', width: 120, alignItems: 'center' },
  spotPillInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: 'rgba(10,12,17,0.72)', maxWidth: 120 },
  spotChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, height: 38, borderRadius: 19 },
  partsBar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 16, borderRadius: R },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface2, borderRadius: 10, padding: 3 },
  stepBtn: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dock: { flexDirection: 'row', gap: 10, paddingHorizontal: GUTTER },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: C.hair, paddingHorizontal: GUTTER },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.surface2, marginTop: 10 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginVertical: 14 },
  sheetLabel: { fontSize: 12.5, fontFamily: F.semibold, letterSpacing: 1, textTransform: 'uppercase', color: C.mute, marginTop: 22, marginBottom: 10, marginLeft: 4 },
  panel: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.hair, borderRadius: R, overflow: 'hidden' },
  spot: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingRight: 8 },
  rail: { width: 4, alignSelf: 'stretch', borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  name: { color: C.text, fontFamily: F.semibold, fontSize: 15.5, padding: 0 },
  meter: { flex: 1, maxWidth: 110, height: 4, borderRadius: 4, backgroundColor: C.surface2 },
  fixBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: C.surface2, marginRight: 6 },
  iconBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  testRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, padding: 14, borderRadius: R, backgroundColor: C.blueSoft },
  logTime: { fontSize: 12, color: C.faint, fontFamily: F.medium, width: 42 },
  toast: { position: 'absolute', alignSelf: 'center', maxWidth: '88%', backgroundColor: C.text, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  blackout: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 10 },
});
