import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextProps, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { C, F, R } from './theme';

export function Tx({ style, ...p }: TextProps) {
  return <Text {...p} style={[{ color: C.text, fontFamily: F.regular, fontSize: 15 }, style]} />;
}

type IconName = 'camera' | 'plus' | 'undo' | 'moon' | 'trash' | 'gear' | 'back' | 'lock' | 'eye' | 'target' | 'minus' | 'list' | 'sparkle';

export function Icon({ name, size = 20, color = C.text, stroke = 2 }: { name: IconName; size?: number; color?: string; stroke?: number }) {
  const p = { stroke: color, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'camera' && (
        <>
          <Path {...p} d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
          <Circle {...p} cx={12} cy={13} r={3.5} />
        </>
      )}
      {name === 'plus' && <Path {...p} d="M12 5v14M5 12h14" />}
      {name === 'minus' && <Path {...p} d="M5 12h14" />}
      {name === 'list' && <Path {...p} d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />}
      {name === 'sparkle' && <Path {...p} d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />}
      {name === 'undo' && (
        <>
          <Path {...p} d="M9 14 4 9l5-5" />
          <Path {...p} d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </>
      )}
      {name === 'moon' && <Path {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
      {name === 'trash' && <Path {...p} d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />}
      {name === 'back' && <Path {...p} d="M15 18l-6-6 6-6" />}
      {name === 'gear' && (
        <>
          <Circle {...p} cx={12} cy={12} r={3} />
          <Path
            {...p}
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
          />
        </>
      )}
      {name === 'lock' && (
        <>
          <Rect {...p} x={5} y={11} width={14} height={10} rx={2} />
          <Path {...p} d="M8 11V7a4 4 0 0 1 8 0v4" />
        </>
      )}
      {name === 'eye' && (
        <>
          <Path {...p} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <Circle {...p} cx={12} cy={12} r={3} />
        </>
      )}
      {name === 'target' && (
        <>
          <Circle {...p} cx={12} cy={12} r={8} />
          <Circle {...p} cx={12} cy={12} r={3} />
        </>
      )}
    </Svg>
  );
}

type BtnKind = 'primary' | 'secondary' | 'stop' | 'ok';

export function Btn({ title, onPress, kind = 'secondary', icon, disabled, style }: { title?: string; onPress: () => void; kind?: BtnKind; icon?: IconName; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const bg = disabled ? C.surface : { primary: C.blue, secondary: C.surface2, stop: 'rgba(248,113,113,0.12)', ok: C.free }[kind];
  const fg = disabled ? C.faint : { primary: '#fff', secondary: C.text, stop: C.taken, ok: '#062b1d' }[kind];
  const border = disabled ? C.hair : { primary: 'transparent', secondary: C.hair, stop: 'rgba(248,113,113,0.25)', ok: 'transparent' }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [st.btn, { backgroundColor: bg, borderColor: border, transform: [{ scale: pressed ? 0.97 : 1 }] }, !title && st.square, style]}
    >
      {icon && <Icon name={icon} color={fg} size={title ? 18 : 20} stroke={title ? 2.2 : 2} />}
      {title ? <Tx style={{ color: fg, fontFamily: F.semibold, fontSize: 15.5 }}>{title}</Tx> : null}
    </Pressable>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: string }) {
  return (
    <View style={st.secH}>
      <Tx style={st.secT}>{title}</Tx>
      {right ? <Tx style={{ fontSize: 13, color: C.faint }}>{right}</Tx> : null}
    </View>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[st.panel, style]}>{children}</View>;
}

export function Chip({ text, color }: { text: string; color: string }) {
  return (
    <View style={st.chip}>
      <View style={[st.dot, { backgroundColor: color }]} />
      <Tx style={{ fontSize: 12.5, fontFamily: F.medium, color: C.text }}>{text}</Tx>
    </View>
  );
}

export const st = StyleSheet.create({
  btn: { flex: 1, height: 54, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  square: { flex: 0, width: 54 },
  secH: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 28, marginBottom: 10, marginHorizontal: 4 },
  secT: { fontSize: 12.5, fontFamily: F.semibold, letterSpacing: 1, textTransform: 'uppercase', color: C.mute },
  panel: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.hair, borderRadius: R, overflow: 'hidden' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99, backgroundColor: C.surface, borderWidth: 1, borderColor: C.hair },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
