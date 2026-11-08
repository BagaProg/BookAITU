import Wallpaper from '../general/map/Wallpaper'
import IconsCommon from '../general/map/IconsCommon'

export default function MapLayout({ children }) {
  return <svg viewBox="0 0 924.69 396.16" xmlns="http://www.w3.org/2000/svg" aria-label="AITU floor plan">
    <Wallpaper />{children}<IconsCommon />
  </svg>
}
