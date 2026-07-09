import { Directive, ElementRef, HostListener, effect, inject, input, output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

// BeSpunky addition — an AUGMENTATION of Angular's RouterLink, NOT a reimplementation.
//
// `hostDirectives: [RouterLink]` inherits the real <a href> and EVERY RouterLink feature
// for free: queryParams, fragment, target, relative routes, state, replaceUrl,
// modifier/middle-click "open in new tab", and RouterLinkActive. bsNavLink adds only what
// RouterLink lacks:
//   1. it binds the navigation-x composer's VALUE (a path string or commands array from
//      useNavigationLinks) — so links stay typed and centralized; and
//   2. it emits `navigated` on each plain-click activation — a consistent, typed seam for
//      analytics / breadcrumbs / telemetry tied to the destination.
//
// Veto concerns (unsaved-changes, auth) deliberately live in Router GUARDS
// (canDeactivate / canActivate), which apply to EVERY navigation source — link, back
// button, deep link, programmatic — not just a click here.
//
//   <a [bsNavLink]="links.toDetail(order)" (navigated)="track($event)">{ order.name }</a>
@Directive({
  selector: 'a[bsNavLink], area[bsNavLink]',
  hostDirectives: [RouterLink],
})
export class BsNavLinkDirective {
  private readonly link = inject(RouterLink);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLAnchorElement>>(ElementRef);

  /** The composer value: a path string or a commands array (useNavigationLinks output). */
  readonly bsNavLink = input.required<string | readonly unknown[]>();

  /** Emitted on each plain-click activation; RouterLink performs the actual navigation. */
  readonly navigated = output<string | readonly unknown[]>();

  constructor() {
    effect(() => {
      const value = this.bsNavLink();
      // RouterLink owns navigation + all of its features, fed from the composer.
      this.link.routerLink = value as string | unknown[];
      // Guarantee a correct href immediately (RouterLink also maintains it on CD/nav).
      this.host.nativeElement.setAttribute('href', this.router.serializeUrl(this.tree(value)));
    });
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    // Non-blocking activation hook; RouterLink handles the actual nav + modifier keys.
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      this.navigated.emit(this.bsNavLink());
    }
  }

  private tree(value: string | readonly unknown[]) {
    return typeof value === 'string'
      ? this.router.parseUrl(value.startsWith('/') ? value : '/' + value)
      : this.router.createUrlTree(value as unknown[]);
  }
}
