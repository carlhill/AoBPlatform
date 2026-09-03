/**
 * The kiosk root. It loads the typefaces and hands over to the ceremony.
 *
 * THE FONTS NEVER GATE THE SCREEN. Barlow and Barlow Condensed are bundled as
 * assets — nothing is fetched at runtime — but if loading fails or is slow the
 * app renders anyway in the fallback stack. A tablet that shows a blank screen
 * because a typeface did not arrive would be a platform outage standing
 * between a patient and their appointment, which is precisely what REQ-REC-04
 * forbids.
 */
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
// Subpath imports, one weight each. The package root re-exports every weight
// in the family, so importing from it would bundle eighteen typefaces to use
// four.
import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular';
import { Barlow_500Medium } from '@expo-google-fonts/barlow/500Medium';
import { Barlow_700Bold } from '@expo-google-fonts/barlow/700Bold';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { Ceremony } from './src/Ceremony';
import { colors } from './src/theme';

export default function App() {
  useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_700Bold,
    BarlowCondensed_600SemiBold,
  });

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <Ceremony />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
});
