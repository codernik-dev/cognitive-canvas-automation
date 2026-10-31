/**
 * The shell specs' `test`: fixtures/test.ts plus `shell`, the page objects
 * for the tour card, tutorial player, language controls, Settings sections,
 * System Check, quick search, select mode and the shell's banners.
 */
import { test as base, expect } from './test.js'
import {
  TourCard, TutorialPlayer, LanguageMenu, LanguageSettings, LanguageOffer,
  SettingsSections, SystemCheck, QuickSearch, ProjectsScreen, ShellBanners,
} from '../pages/ShellPages.js'

export interface Shell {
  tour: TourCard
  tutorial: TutorialPlayer
  languageMenu: LanguageMenu
  language: LanguageSettings
  languageOffer: LanguageOffer
  sections: SettingsSections
  systemCheck: SystemCheck
  quickSearch: QuickSearch
  projects: ProjectsScreen
  banners: ShellBanners
}

export const test = base.extend<{ shell: Shell }>({
  shell: async ({ page }, provide) => {
    await provide({
      tour: new TourCard(page),
      tutorial: new TutorialPlayer(page),
      languageMenu: new LanguageMenu(page),
      language: new LanguageSettings(page),
      languageOffer: new LanguageOffer(page),
      sections: new SettingsSections(page),
      systemCheck: new SystemCheck(page),
      quickSearch: new QuickSearch(page),
      projects: new ProjectsScreen(page),
      banners: new ShellBanners(page),
    })
  },
})

export { expect }
