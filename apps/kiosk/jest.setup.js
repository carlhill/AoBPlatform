/* eslint-disable */
// The font loader reaches for native modules that do not exist under jsdom.
// Tests are about the hard rules, not about typefaces.
jest.mock('expo-font', () => ({ useFonts: () => [true, null], isLoaded: () => true }));
