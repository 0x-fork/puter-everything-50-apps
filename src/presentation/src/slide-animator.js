// Plays a slide's animations during a slide show. The show asks the animator
// for each advance before it moves to the next slide, so a slide with click
// steps uses its clicks first.
//
//   createSlideAnimator({ pres, slide, frame, image, reducedMotion })
//
// `frame` is the show's slide container and `image` the slide's rendered
// picture inside it; the animator may lay pictures of its own over or in
// place of `image`, and must remove them in `destroy()`.
//
// The returned animator:
//   steps          the number of click steps on the slide
//   start()        shows the slide's opening state (objects that enter later
//                  are hidden) and plays what runs before the first click
//   next()         plays the next click step; false when none is left, so
//                  the show moves on to the next slide
//   previous()     returns to the state before the last step; false at the
//                  first step, so the show goes back a slide
//   finish()       shows the slide's final state at once, as a slide reached
//                  by going back is shown
//   destroy()      removes whatever the animator added
//
// This version plays no animations: every slide shows as rendered.
export function createSlideAnimator() {
  return {
    steps: 0,
    start() {},
    next: () => false,
    previous: () => false,
    finish() {},
    destroy() {},
  };
}
