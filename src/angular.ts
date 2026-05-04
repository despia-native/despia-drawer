import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  NgModule,
  OnDestroy,
  Output,
  ViewChild
} from '@angular/core';
import { SmoothDrawer as SmoothDrawerElement } from './index';

void SmoothDrawerElement;

@Component({
  selector: 'despia-smooth-drawer',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <smooth-drawer
      #el
      [attr.detents]="detents"
      [attr.detent]="detent"
      [attr.backdrop]="backdrop"
      [attr.theme]="theme"
      [attr.theme-transition]="themeTransition"
      [attr.snap-mode]="snapMode"
      [attr.hide-scrollbar]="hideScrollbar ? '' : null"
      [attr.smart-keyboard]="smartKeyboard ? '' : null"
    >
      <ng-content></ng-content>
    </smooth-drawer>
  `
})
export class SmoothDrawerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('el') elRef!: ElementRef<any>;

  @Input() detents?: string;
  @Input() detent?: string;
  @Input() backdrop?: string;
  @Input() theme?: 'light' | 'dark' | 'auto';
  @Input() themeTransition?: string;
  @Input() snapMode?: 'momentum' | 'strict';
  @Input() hideScrollbar = false;
  @Input() smartKeyboard = false;

  @Output() detentChange = new EventEmitter<any>();
  @Output() detentChanging = new EventEmitter<any>();
  @Output() progress = new EventEmitter<any>();

  private listeners: Array<[string, (e: any) => void]> = [];

  ngAfterViewInit(): void {
    const el = this.elRef.nativeElement;
    const handlers: Array<[string, (e: any) => void]> = [
      ['detent-change', (e) => this.detentChange.emit(e.detail)],
      ['detent-changing', (e) => this.detentChanging.emit(e.detail)],
      ['drawer-progress', (e) => this.progress.emit(e.detail)]
    ];

    handlers.forEach(([name, fn]) => {
      el.addEventListener(name, fn);
      this.listeners.push([name, fn]);
    });
  }

  ngOnDestroy(): void {
    const el = this.elRef?.nativeElement;
    if (!el) return;
    this.listeners.forEach(([name, fn]) => el.removeEventListener(name, fn));
  }

  show(name?: string) { return this.elRef.nativeElement.show(name); }
  hide() { return this.elRef.nativeElement.hide(); }
  toggle() { return this.elRef.nativeElement.toggle(); }
  snapTo(name: string) { return this.elRef.nativeElement.snapTo(name); }
  next() { return this.elRef.nativeElement.next(); }
  previous() { return this.elRef.nativeElement.previous(); }
  getState() { return this.elRef.nativeElement.getState(); }
  refreshLayout() { return this.elRef.nativeElement.refreshLayout(); }
}

@NgModule({
  imports: [SmoothDrawerComponent],
  exports: [SmoothDrawerComponent]
})
export class SmoothDrawerModule {}
