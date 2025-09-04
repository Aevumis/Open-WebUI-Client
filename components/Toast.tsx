import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

export type ToastOptions = {
  type?: 'info' | 'success' | 'error';
  duration?: number; // ms
};

export type ToastApi = {
  show: (message: string, opts?: ToastOptions) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<Array<{ id: string; message: string; type: NonNullable<ToastOptions['type']> }>>([]);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animateIn = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start();
  }, [opacity, translateY]);

  const animateOut = useCallback((cb?: () => void) => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true, easing: Easing.in(Easing.cubic) }),
      Animated.timing(translateY, { toValue: -12, duration: 160, useNativeDriver: true, easing: Easing.in(Easing.cubic) }),
    ]).start(({ finished }) => finished && cb && cb());
  }, [opacity, translateY]);

  const show = useCallback((message: string, opts?: ToastOptions) => {
    const type = opts?.type ?? 'info';
    const duration = opts?.duration ?? 1800;

    // Replace current toast rather than stacking infinitely
    const id = String(Date.now());
    setItems([{ id, message, type }]);

    if (Platform.OS !== 'web') {
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); } catch {}
    }

    if (timerRef.current) clearTimeout(timerRef.current as any);
    animateIn();
    timerRef.current = setTimeout(() => {
      animateOut(() => setItems([]));
    }, duration);
  }, [animateIn, animateOut]);

  const value = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      <View style={{ flex: 1 }}>{children}</View>
      {/* Overlay container */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.container}>
          {items.map((t) => (
            <Animated.View key={t.id} style={[styles.toast, styles[t.type], { opacity, transform: [{ translateY }] }]}>
              <Text style={styles.text} numberOfLines={2}>
                {t.message}
              </Text>
            </Animated.View>
          ))}
        </View>
      </View>
    </ToastContext.Provider>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.select({ ios: 12, android: 12, default: 8 }),
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toast: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    maxWidth: '90%',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  info: { backgroundColor: 'rgba(0,0,0,0.8)' },
  success: { backgroundColor: 'rgba(10,126,164,0.95)' },
  error: { backgroundColor: 'rgba(200,40,40,0.95)' },
  text: {
    color: '#fff',
    fontWeight: '600',
  },
});
