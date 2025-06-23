<template>
  <!-- footer -->
  <footer class="modern-card mt-8 py-6 px-6 text-sm">
    <div class="flex flex-col md:flex-row items-center justify-between gap-4">
      <div class="flex flex-wrap items-center justify-center md:justify-start text-gray-600 dark:text-gray-400 text-center md:text-left">
        <span>&copy;&nbsp;{{ new Date().getFullYear() }}&nbsp;</span>
        <span>Made with&nbsp;</span>
        <img src="../../assets/images/heart.svg" class="mx-1 w-4 h-4" alt="heart" />
        <span>&nbsp;by&nbsp;</span>
        <a class="text-epix-primary hover:text-epix-secondary font-semibold transition-colors duration-200"
           href="https://epix.zone" target="_blank" rel="noopener noreferrer">Epix</a>
        <span>&nbsp;and&nbsp;</span>
        <a class="text-epix-primary hover:text-epix-secondary font-semibold transition-colors duration-200"
           href="https://ping.pub/" target="_blank" rel="noopener noreferrer">Ping.Pub</a>
      </div>
      <div class="flex items-center justify-center space-x-6">
        <a class="text-gray-600 dark:text-gray-400 hover:text-epix-primary font-medium transition-colors duration-200"
           href="https://github.com/EpixZone/epix.explorer/blob/master/LICENSE" target="_blank" rel="noopener noreferrer">
          License
        </a>
        <a class="text-gray-600 dark:text-gray-400 hover:text-epix-primary font-medium transition-colors duration-200"
           href="https://github.com/EpixZone/epix.explorer" target="_blank" rel="noopener noreferrer">
          Github
        </a>
      </div>
    </div>
  </footer>
</template>